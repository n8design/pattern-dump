// The stylesheets Sass never compiles, read for their classes: `assets.css` files and a template's `<style>`. A
// stylesheet on another host, or a template's own `<link>`, is only named, never fetched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cssTextClasses, inlineStyleClasses, linkedStylesheets, readAssetStylesheets, styleAttributeProperties } from "../src/plain-stylesheets.js";
import { save } from "../../../test-support/save.js";

let assets = "";
beforeAll(async () => {
  // Its real path: the file found is the real file (contained-file.ts), and macOS puts tmpdir() behind a link.
  assets = await realpath(await mkdtemp(join(tmpdir(), "pd-plain-sheets-")));
  await mkdir(join(assets, "css"), { recursive: true });
  await save(join(assets, "css/vendor.css"), `.vendor-grid { display: grid; }\n.vendor-grid > .button { margin: 0; }\n`);
});
afterAll(async () => { if (assets) await rm(assets, { recursive: true, force: true }); });

describe("cssTextClasses", () => {
  it("separates defined from mentioned classes, with the first selector of each", () => {
    const c = cssTextClasses(`.a, .b > .c { x: 1 }\n.a:not(.d) { y: 2 }\n@media (min-width: 1px) { .e .a { z: 3 } }\n`, "/x/a.css");
    expect([...c.defines]).toEqual([["a", ".a, .b > .c"]]);
    expect([...c.mentions]).toEqual([["b", ".a, .b > .c"], ["c", ".a, .b > .c"], ["d", ".a:not(.d)"], ["e", ".e .a"]]);
  });

  it("draws nothing from Math.random (a project helper's seeded sequence stays as it was)", () => {
    const real = Math.random;
    let draws = 0;
    Math.random = () => { draws++; return real(); };
    try { cssTextClasses(`.a { x: 1 }`, "/x/a.css"); inlineStyleClasses(`<style>.b { y: 2 }</style>`, "/x/b.hbs"); } finally { Math.random = real; }
    expect(draws).toBe(0);
  });

  it("gives nothing for text that doesn't parse", () => {
    expect(cssTextClasses(`}}} .a {`, "/x/a.css").defines.size).toBe(0);
  });
});

describe("a template's <style>", () => {
  it("is read, with a Handlebars expression in it blanked", () => {
    const hbs = `<div class="promo">\n<style>\n.promo { color: {{color}}; }\n.promo .button { margin: 0; }\n{{#if wide}}.promo-wide { width: 100%; }{{/if}}\n</style>\n</div>\n`;
    const c = inlineStyleClasses(hbs, "/x/promo.hbs")!;
    expect([...c.defines.keys()]).toEqual(["promo", "promo-wide"]);
    expect([...c.mentions]).toEqual([["button", ".promo .button"]]);
  });

  it("is null for a template with none", () => {
    expect(inlineStyleClasses(`<p style="color: red">x</p>`, "/x/p.hbs")).toBeNull();
  });
});

describe("linkedStylesheets", () => {
  it("names each stylesheet link as written, and leaves out one whose address is an expression", () => {
    const hbs = `<link rel="stylesheet" href="https://cdn.example/x.css">\n<link href='/assets/y.css' rel='stylesheet'>\n<link rel="preload" href="/f.woff2">\n<link rel="stylesheet" href="{{sheet}}">\n`;
    expect(linkedStylesheets(hbs)).toEqual(["/assets/y.css", "https://cdn.example/x.css"]);
  });
});

describe("readAssetStylesheets", () => {
  it("reads a local assets.css file and only names a URL or a missing file", async () => {
    const out = await readAssetStylesheets(
      ["css/vendor.css", "https://fonts.example/css2?family=X", "css/missing.css"], [assets], ["assets"], f => readFile(f, "utf8"));
    expect(out.map(s => [s.entry, s.file])).toEqual([
      ["css/vendor.css", join(assets, "css/vendor.css")], ["https://fonts.example/css2?family=X", null], ["css/missing.css", null],
    ]);
    const vendor = out[0]!;
    if (vendor.file === null) throw new Error("not read");
    expect([...vendor.classes.defines.keys()]).toEqual(["vendor-grid"]);
    expect([...vendor.classes.mentions.keys()]).toEqual(["button"]);
  });
});

describe("styleAttributeProperties", () => {
  it("names the custom properties a template's style attributes set, through Handlebars blocks and values", () => {
    const hbs = `<h1 style="--title-em: {{em title}}">x</h1>\n<menu {{#if cols}}style="{{#if cols.d}}--cols-desk: {{ cols.d }};{{/if}} color: red"{{/if}}>`
      + `<p style='--b: 1; --a: 2'></p>`;
    expect(styleAttributeProperties(hbs)).toEqual(["--a", "--b", "--cols-desk", "--title-em"]);
    expect(styleAttributeProperties(`<p class="x">none</p>`)).toEqual([]);
  });
});
