// A renderer given its discovery maps reads each file once, compiles each template once and only when a render
// calls it, and shares data between renders frozen (source-store.ts). Data is merged into new objects, so no
// source changes; a helper that writes to the data it is given throws; a lookup by name finds every component.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Handlebars from "handlebars";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer, deepMerge } from "../src/index";
import { deepFreeze, mergeData, templateKey } from "../src/source-store";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-source-store-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

/** A fresh patterns folder with `files`, and a renderer given its maps. */
async function renderer(files: Record<string, string>, helpers?: (env: typeof Handlebars) => void) {
  const dir = join(tmp, `p-${n++}`);
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await save(join(dir, rel), text);
  }
  const { discoveryMap, handleMap } = await buildDiscoveryMap(dir);
  return createRenderer({ patternsDir: dir, discoveryMap, handleMap, ...(helpers ? { helperRegistrars: [helpers] } : {}) });
}

describe("mergeData", () => {
  it("gives what deepMerge gives on a copy, and changes no source", () => {
    const a = { x: 1, o: { p: 1, q: { r: 1 } }, list: [1] };
    const b = { o: { q: { s: 2 } }, list: [2], y: "y" };
    const c = { o: { p: 3 }, z: null };
    const before = JSON.stringify([a, b, c]);
    expect(mergeData(a, undefined, b, c)).toEqual(deepMerge(structuredClone(a), undefined, b, c));
    expect(JSON.stringify([a, b, c])).toBe(before);
  });

  it("merges frozen sources", () => {
    const merged = mergeData(deepFreeze({ o: { p: 1 } }), deepFreeze({ o: { q: 2 } }));
    expect(merged).toEqual({ o: { p: 1, q: 2 } });
  });
});

describe("templateKey", () => {
  it("differs with the source, the options and what else the template is compiled from", () => {
    const base = templateKey("<b>{{x}}</b>", { preventIndent: true });
    expect(templateKey("<b>{{x}}</b>", { preventIndent: true })).toBe(base);
    expect(templateKey("<b>{{y}}</b>", { preventIndent: true })).not.toBe(base);
    expect(templateKey("<b>{{x}}</b>", { preventIndent: false })).not.toBe(base);
    expect(templateKey("<b>{{x}}</b>", { preventIndent: true }, "schema")).not.toBe(base);
  });
});

describe("a renderer given its maps", () => {
  it("compiles a template once, and only the partials a render calls", async () => {
    const render = await renderer({
      "atoms/used/used.hbs": "<i>used-partial {{n}}</i>\n",
      "atoms/unused-a/unused-a.hbs": "<i>unused-a-partial</i>\n",
      "atoms/unused-b/unused-b.hbs": "<i>unused-b-partial</i>\n",
      "molecules/page/page.hbs": "<p>page-main {{> atoms-used n=2}}</p>\n",
    });
    // Handlebars' compiler, as source-store.ts uses it: each call is one template compiled (the diagnostics parse the
    // main template too, but never compile it).
    const compiler = (Handlebars as unknown as { Compiler: { prototype: { compile(p: hbs.AST.Program): unknown } } }).Compiler.prototype;
    const compile = vi.spyOn(compiler, "compile");
    const compiled = () => compile.mock.calls.map(c => JSON.stringify(c[0])).join("\n");
    try {
      expect((await render({ component: "molecules/page" })).html).toContain("page-main <i>used-partial 2</i>");
      expect(compile).toHaveBeenCalledTimes(2);
      expect(compiled()).toContain("page-main");
      expect(compiled()).toContain("used-partial");
      expect(compiled()).not.toContain("unused-");
      expect((await render({ component: "molecules/page" })).html).toContain("used-partial 2");
      expect(compile).toHaveBeenCalledTimes(2);
    } finally { compile.mockRestore(); }
  });

  it("finds any component by name from a helper (a dynamic partial), and compiles it then", async () => {
    const render = await renderer({
      "atoms/late/late.hbs": "<i>late-partial {{v}}</i>\n",
      "molecules/page/page.hbs": `<p>{{dyn "atoms-late"}}</p>\n`,
    }, env => {
      env.registerHelper("dyn", function (name: string) {
        const partial = env.partials[name] as unknown;
        if (typeof partial !== "function") return `[no partial: ${name}]`;
        return new env.SafeString((partial as (c: object) => string)({ v: "x" }));
      });
    });
    expect((await render({ component: "molecules/page" })).html).toContain("<p><i>late-partial x</i>");
  });

  it("stops a helper that writes to the data it is given, and the next render is as before", async () => {
    const render = await renderer({
      "atoms/card/card.hbs": "<p>{{title}} {{shout meta}} {{meta.tone}}</p>\n",
      "atoms/card/card.json": `{ "title": "card-title", "meta": { "tone": "calm" } }\n`,
    }, env => {
      env.registerHelper("shout", function (meta: { tone: string }) { meta.tone = "LOUD"; return ""; });
    });
    await expect(render({ component: "atoms/card" })).rejects.toThrow(TypeError);
    // The data file's values are unchanged for the next render (a template without the helper shows them).
    const plain = await renderer({
      "atoms/card/card.hbs": "<p>{{title}} {{meta.tone}}</p>\n",
      "atoms/card/card.json": `{ "title": "card-title", "meta": { "tone": "calm" } }\n`,
    });
    expect((await plain({ component: "atoms/card" })).html).toContain("card-title calm");
  });

  it("gives live data over the data file, without changing either", async () => {
    const render = await renderer({
      "atoms/card/card.hbs": "<p>{{meta.tone}} {{meta.size}}</p>\n",
      "atoms/card/card.json": `{ "meta": { "tone": "calm", "size": "s" } }\n`,
    });
    const live = { meta: { size: "l" } };
    expect((await render({ component: "atoms/card", data: live })).html).toContain("calm l");
    expect(live).toEqual({ meta: { size: "l" } });
    expect((await render({ component: "atoms/card" })).html).toContain("calm s");
  });
});
