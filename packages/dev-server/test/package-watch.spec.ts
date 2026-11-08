// A linked pattern package (a `file:` dependency: vendor/ds, linked into node_modules) is watched like
// the project: each kind of change sends the messages the project's own would, and the same whether the
// file was edited through its real folder (vendor/…) or through the link (node_modules/…). An installed
// copy is not watched: its folders are not in the watch list, and an edit to it is not handled.
// Each case runs on a fresh project, through watch-harness.ts (no waiting for quiet).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { loadPatternPackages } from "../src/packages.js";
import { resolveServerConfig } from "../src/server-config.js";
import { watchedRoots } from "../src/watch-roots.js";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;

const MANIFEST = {
  patterns: "patterns", styles: { dir: "styles", documentBase: ["base"] }, themes: { dir: "themes", default: "light" },
};
const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "@acme/ds", version: "1.0.0", patternDump: MANIFEST }),
  "patterns/atoms/chip/chip.hbs": `<span class="chip">{{label}}</span>\n`,
  "patterns/atoms/chip/chip.json": `{ "label": "Chip" }\n`,
  "patterns/layouts/page/page.hbs": `<main class="page">{{{body}}}</main>\n`,
  "styles/atoms/chip.scss": `@use "tokens";\n.chip {\n  color: tokens.$ink;\n}\n`,
  "styles/atoms/_tokens.scss": "$ink: red;\n",
  "styles/base/reset.scss": "body {\n  margin: 0;\n}\n",
  "themes/light.theme.scss": ":root {\n  --chip: red;\n}\n",
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

/** A fresh project using @acme/ds, linked (vendor/ds and a link in node_modules) or as an installed copy. */
async function project(kind: "linked" | "copy"): Promise<Bench> {
  const root = join(tmp, `site-${n++}`);
  await mkdir(join(root, "src", "patterns"), { recursive: true });
  await mkdir(join(root, "src", "styles"), { recursive: true });
  const installed = join(root, "node_modules", "@acme", "ds");
  if (kind === "linked") {
    for (const [rel, text] of Object.entries(FILES)) await write(join(root, "vendor", "ds", rel), text);
    await mkdir(dirname(installed), { recursive: true });
    await symlink(join("..", "..", "vendor", "ds"), installed);
  } else {
    for (const [rel, text] of Object.entries(FILES)) await write(join(installed, rel), text);
  }
  const b = new Bench(root, "atoms/chip");
  await b.start(config);
  return b;
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-package-watch-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

// A change to the package, given its path in the package; and what the project's watcher sends for it.
type Case = [name: string, act: (b: Bench, at: (rel: string) => string) => Promise<void>, event: string, file: string, messages: string[]];
const CASES: Case[] = [
  ["a template", (b, at) => b.edit(at("patterns/atoms/chip/chip.hbs"), "\n"), "change", "patterns/atoms/chip/chip.hbs", [
    `{"type":"content-swap","componentId":"atoms/chip"}`,
  ]],
  ["its data", (b, at) => b.edit(at("patterns/atoms/chip/chip.json"), "\n"), "change", "patterns/atoms/chip/chip.json", [
    `{"type":"content-swap","componentId":"atoms/chip"}`,
  ]],
  ["its stylesheet", (b, at) => b.edit(at("styles/atoms/chip.scss"), "\n.chip-x { color: blue; }\n"), "change", "styles/atoms/chip.scss", [
    `{"type":"css-link-swap","componentId":"atoms/chip","href":"/_pd/components/atoms/chip.css?v=<t>","orderedHrefs":["/_pd/components/atoms/chip.css?v=<t>"]}`,
  ]],
  // A partial: only the dependency tracker knows which stylesheets use it.
  ["a partial its stylesheet uses", (b, at) => b.edit(at("styles/atoms/_tokens.scss"), "\n$ink-2: blue;\n"), "change", "styles/atoms/_tokens.scss", [
    `{"type":"css-link-swap","componentId":"atoms/chip","href":"/_pd/components/atoms/chip.css?v=<t>","orderedHrefs":["/_pd/components/atoms/chip.css?v=<t>"]}`,
  ]],
  ["a base-layer file", (b, at) => b.edit(at("styles/base/reset.scss"), "\nhtml { color: black; }\n"), "change", "styles/base/reset.scss", [
    `{"type":"content-swap","componentId":"atoms/chip"}`,
  ]],
  ["a theme", (b, at) => b.edit(at("themes/light.theme.scss"), "\n:root { --chip-x: 1; }\n"), "change", "themes/light.theme.scss", [
    `{"type":"content-swap","componentId":"atoms/chip"}`,
  ]],
  ["a layout", (b, at) => b.edit(at("patterns/layouts/page/page.hbs"), "\n"), "change", "patterns/layouts/page/page.hbs", [
    `{"type":"content-swap","componentId":"layouts/page"}`,
  ]],
  ["a new component", (b, at) => b.create(at("patterns/atoms/tag/tag.hbs"), "<b>tag</b>\n"), "add", "patterns/atoms/tag/tag.hbs", [
    `{"type":"tree-changed"}`,
  ]],
];

describe("a linked package is watched like the project", () => {
  for (const [name, act, event, file, messages] of CASES) {
    for (const via of ["vendor/ds", "node_modules/@acme/ds"]) {
      it(`${name}, edited through ${via}`, async () => {
        const b = await project("linked");
        const at = (rel: string) => `${via}/${rel}`;
        // Whichever path the edit went through, the watcher handles it at the package's real folder.
        const result = await b.step(() => act(b, at), [[event, `vendor/ds/${file}`]]);
        expect(result.events.filter(([e]) => e !== "addDir")).toEqual([[event, `vendor/ds/${file}`]]);
        expect(result.messages).toEqual(messages);
      }, 60_000);
    }
  }
});

describe("an installed copy is not watched", () => {
  it("leaves its folders out of the watch list", async () => {
    const b = await project("copy");
    const cfg = resolveServerConfig(config, b.root, {}, loadPatternPackages(config.packages, b.root));
    const copy = realpathSync(join(b.root, "node_modules", "@acme", "ds"));
    const roots = watchedRoots(cfg);
    const all = [...roots.patterns, ...roots.styles.map(r => r.dir), ...roots.themes, ...roots.scripts];
    expect(all.filter(d => d.startsWith(copy))).toEqual([]);
    // The project's own folders are watched.
    expect(roots.patterns).toEqual([join(b.root, "src", "patterns")]);
  }, 60_000);

  it("handles no edit to it, and sends nothing", async () => {
    const b = await project("copy");
    const result = await b.step(() => b.edit("node_modules/@acme/ds/patterns/atoms/chip/chip.hbs", "\n"), []);
    expect(result).toEqual({ messages: [], events: [] });
    // And a linked one is: the same edit handled, as a control.
    const linked = await project("linked");
    const from = handled.length;
    await linked.edit("vendor/ds/patterns/atoms/chip/chip.hbs", "\n");
    await whenHandled(() => handled.slice(from).some(h => linked.owns(h.path) && h.path.endsWith("chip.hbs")));
  }, 60_000);
});
