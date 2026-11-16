// pd dev never renders a stale template: the renderer keeps templates, data and schemas in memory between renders,
// and an edit to any of them, in the project or in a linked package (through its real folder or the link), shows
// on the next render. Each case renders once first, so whatever the renderer keeps is filled, then makes one edit
// and waits until the watcher has handled it (watch-harness.ts), then renders again, read over HTTP.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { componentUrl, previewUrl, type ComponentDetail } from "@pattern-dump/contracts";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;

const PACKAGE: Record<string, string> = {
  "package.json": JSON.stringify({ name: "@acme/ds", version: "1.0.0", patternDump: { patterns: "patterns", styles: { dir: "styles" } } }),
  "patterns/atoms/chip/chip.hbs": `<span class="chip">{{label}}</span>\n`,
  "patterns/atoms/chip/chip.json": `{ "label": "chip-label-1" }\n`,
  "patterns/atoms/chip/chip.schema.json": `{ "type": "object", "properties": { "label": { "type": "string" } } }\n`,
};
const PROJECT: Record<string, string> = {
  "src/patterns/molecules/card/card.hbs": `<article class="card"><h2>{{title}}</h2>{{> atoms-badge}}{{> atoms-chip}}</article>\n`,
  "src/patterns/molecules/card/card.json": `{ "title": "card-title-1" }\n`,
  "src/patterns/molecules/card/card.schema.json": `{ "type": "object", "properties": { "title": { "type": "string" } } }\n`,
  "src/patterns/atoms/badge/badge.hbs": `<b class="badge">badge-text-1</b>\n`,
};
const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  packages: ["@acme/ds"],
}), "site");

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await save(path, text);
}

/** A fresh project: its own card and badge, and @acme/ds linked (vendor/ds, and a link in node_modules). */
async function project(): Promise<Bench> {
  const root = join(tmp, `site-${n++}`);
  for (const [rel, text] of Object.entries(PROJECT)) await write(join(root, rel), text);
  await mkdir(join(root, "src", "styles"), { recursive: true });
  for (const [rel, text] of Object.entries(PACKAGE)) await write(join(root, "vendor", "ds", rel), text);
  const installed = join(root, "node_modules", "@acme", "ds");
  await mkdir(dirname(installed), { recursive: true });
  await symlink(join("..", "..", "vendor", "ds"), installed);
  const b = new Bench(root, null);
  await b.start(config);
  return b;
}

const preview = async (b: Bench, id: string): Promise<string> => (await fetch(`${b.origin}${previewUrl(id)}`)).text();
const diagnostics = async (b: Bench, id: string): Promise<string[]> =>
  ((await (await fetch(`${b.origin}${componentUrl(id)}`)).json()) as ComponentDetail).diagnostics.map(d => `${d.kind} ${d.message}`);

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-render-fresh-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

// What is edited, the file as it becomes, and how the next render shows it.
type Case = [name: string, rel: string, text: string, shows: (b: Bench) => Promise<void>];
const showsInCard = (text: string) => async (b: Bench) => { expect(await preview(b, "molecules/card")).toContain(text); };
const required = (key: string, props: string) => `{ "type": "object", "required": ["${key}"], "properties": { ${props} } }\n`;

const projectCases: Case[] = [
  ["a template", "src/patterns/molecules/card/card.hbs",
    `<article class="card"><h2>{{title}}</h2><p>card-template-2</p>{{> atoms-badge}}{{> atoms-chip}}</article>\n`, showsInCard("card-template-2")],
  ["a data file", "src/patterns/molecules/card/card.json", `{ "title": "card-title-2" }\n`, showsInCard("card-title-2")],
  ["a partial it includes", "src/patterns/atoms/badge/badge.hbs", `<b class="badge">badge-text-2</b>\n`, showsInCard("badge-text-2")],
  ["a schema", "src/patterns/molecules/card/card.schema.json", required("subtitle", `"title": { "type": "string" }, "subtitle": { "type": "string" }`),
    async b => { expect(await diagnostics(b, "molecules/card")).toContain(`UNFILLED_REQUIRED Required field "subtitle" is absent in the merged data`); }],
];
const packageCases: Case[] = [
  ["a template (a partial the project includes)", "patterns/atoms/chip/chip.hbs", `<span class="chip">chip-template-2 {{label}}</span>\n`, showsInCard("chip-template-2")],
  ["a data file", "patterns/atoms/chip/chip.json", `{ "label": "chip-label-2" }\n`, showsInCard("chip-label-2")],
  ["a schema", "patterns/atoms/chip/chip.schema.json", required("size", `"label": { "type": "string" }, "size": { "type": "string" }`),
    async b => { expect(await diagnostics(b, "atoms/chip")).toContain(`UNFILLED_REQUIRED Required field "size" is absent in the merged data`); }],
];

describe("pd dev renders an edit on the next render", () => {
  for (const [name, rel, text, shows] of projectCases) {
    it(`in the project: ${name}`, async () => {
      const b = await project();
      // The first renders, before the edit: the card with its partials, and each component's detail.
      expect(await preview(b, "molecules/card")).toContain("card-title-1");
      expect(await preview(b, "molecules/card")).toContain("chip-label-1");
      await diagnostics(b, "molecules/card");
      await b.step(() => b.create(rel, text));
      await shows(b);
      await b.close();
    }, 60_000);
  }
  for (const [name, rel, text, shows] of packageCases) {
    for (const via of ["vendor/ds", "node_modules/@acme/ds"]) {
      it(`in a linked package, edited through ${via}: ${name}`, async () => {
        const b = await project();
        expect(await preview(b, "molecules/card")).toContain("chip-label-1");
        await diagnostics(b, "atoms/chip");
        await b.step(() => b.create(`${via}/${rel}`, text));
        await shows(b);
        await b.close();
      }, 60_000);
    }
  }
});
