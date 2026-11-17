// pd dev never assembles a site page from a stale file: the storefront's checks keep the design system's templates,
// schemas and sample data in memory between requests (design-files.ts), and an edit to any of them, in the project
// or in a linked package (through its real folder or the link), shows on the next request for the page. Each case
// asks for the page first, so whatever is kept is filled, then makes one edit and waits until the watcher has
// handled it (watch-harness.ts), then asks again.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;

const PACKAGE: Record<string, string> = {
  "package.json": JSON.stringify({ name: "@acme/ds", version: "1.0.0", patternDump: { patterns: "patterns", styles: { dir: "styles" } } }),
  "patterns/atoms/chip/chip.hbs": `<span class="chip">chip-template-1</span>\n`,
  "patterns/atoms/chip/chip.json": `{ "title": "chip-sample" }\n`,
  "patterns/atoms/chip/chip.schema.json": `{ "type": "object", "properties": { "title": { "type": "string" } } }\n`,
};
const LAYOUT_SCHEMA = (extra = "") =>
  `{ "type": "object", ${extra}"properties": { "title": { "type": "string" }, "body": { "type": "string" } } }\n`;
const PROJECT: Record<string, string> = {
  "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}{{> atoms-badge}}{{> atoms-chip}}</main>\n`,
  "src/patterns/layouts/page/page.schema.json": LAYOUT_SCHEMA(),
  "src/patterns/layouts/page/page.json": `{ "title": "layout-sample" }\n`,
  "src/patterns/atoms/badge/badge.hbs": `<b class="badge">badge-text-1</b>\n`,
  "pages/index.md": "---\ntitle: Home\n---\n\nHome body.\n",
};
const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  packages: ["@acme/ds"],
  storefront: { pagesDir: "./pages", outDir: "./site" },
}), "site");

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await save(path, text);
}

/** A fresh project with a site, its own layout and badge, and @acme/ds linked (vendor/ds, and a link in node_modules). */
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

/** The home page as the site's host serves it. */
function home(b: Bench): Promise<string> {
  const port = Number(new URL(b.origin).port);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/", headers: { host: `live.localhost:${port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-storefront-fresh-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

// What is edited, the file as it becomes, and what the next request for the page shows.
type Case = [name: string, rel: string, text: string, shows: string];
const TAGS_AS_TEXT = `{{#each tags}}<i>{{this}}</i>{{/each}}`;
const TAGS_AS_STRINGS = `{ "type": "object", "properties": { "title": { "type": "string" }, "tags": { "type": "array", "items": { "type": "string" } } } }\n`;

const projectCases: Case[] = [
  ["the layout's template", "src/patterns/layouts/page/page.hbs",
    `<main><h1>{{title}}</h1><p>layout-template-2</p>{{{body}}}{{> atoms-badge}}{{> atoms-chip}}</main>\n`, "layout-template-2"],
  ["the layout's schema", "src/patterns/layouts/page/page.schema.json", LAYOUT_SCHEMA(`"required": ["subtitle"], `), "subtitle"],
  ["the layout's sample data", "src/patterns/layouts/page/page.json", `{ "title": "layout-sample", "motto": "x" }\n`,
    `sets "motto", which layouts/page does not declare`],
  ["a partial's template, read by a check", "src/patterns/atoms/badge/badge.hbs", `<b class="badge">${TAGS_AS_TEXT}</b>\n`,
    "atoms/badge (badge.hbs:1)"],
];
const packageCases: Case[] = [
  ["a partial's template", "patterns/atoms/chip/chip.hbs", `<span class="chip">${TAGS_AS_TEXT}</span>\n`, "atoms/chip (chip.hbs:1)"],
  ["a partial's sample data", "patterns/atoms/chip/chip.json", `{ "title": "chip-sample", "motto": "x" }\n`,
    `sets "motto", which layouts/page does not declare`],
  ["a partial's schema", "patterns/atoms/chip/chip.schema.json", TAGS_AS_STRINGS, "atoms/chip (chip.schema.json) declares tags as a list of strings"],
];

describe("pd dev assembles a site page from the files as they are now", () => {
  for (const [name, rel, text, shows] of projectCases) {
    it(`in the project: ${name}`, async () => {
      const b = await project();
      const before = await home(b);
      expect(before).toContain("Home body.");
      expect(before).not.toContain(shows);
      await b.step(() => b.create(rel, text));
      expect(await home(b)).toContain(shows);
      await b.close();
    }, 60_000);
  }
  for (const [name, rel, text, shows] of packageCases) {
    for (const via of ["vendor/ds", "node_modules/@acme/ds"]) {
      it(`in a linked package, edited through ${via}: ${name}`, async () => {
        const b = await project();
        const before = await home(b);
        expect(before).toContain("chip-template-1");
        expect(before).not.toContain(shows);
        await b.step(() => b.create(`${via}/${rel}`, text));
        expect(await home(b)).toContain(shows);
        await b.close();
      }, 60_000);
    }
  }
});
