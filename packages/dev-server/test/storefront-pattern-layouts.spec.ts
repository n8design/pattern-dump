// Page and template patterns as storefront layouts: `"x-pd-layout": "<name>"` in the schema of a pattern in pages/
// or templates/ makes it the layout <name> (layout-index.ts). A page names it as any layout. Clashes name both files;
// a marker elsewhere makes no layout; the page's markdown goes into the property x-pd-content names, else body.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { layoutIndex } from "../src/storefront/layout-index.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-pattern-layouts-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const json = (v: unknown) => JSON.stringify(v);
const PAGE_LAYOUT: Record<string, string> = {
  "patterns/layouts/page/page.hbs": "<main><h1>{{title}}</h1>{{{body}}}</main>",
  "patterns/layouts/page/page.schema.json": json({ properties: { title: { type: "string" } } }),
};
const CASE_STUDY = (folder: string, extra: Record<string, unknown> = {}): Record<string, string> => ({
  [`patterns/${folder}/case-study/case-study.hbs`]: `<main class="case-study"><h1>{{title}}</h1><p class="client">{{client}}</p><div class="content">{{{content}}}</div></main>`,
  [`patterns/${folder}/case-study/case-study.schema.json`]: json({
    "x-pd-layout": "case-study", "x-pd-content": "content",
    properties: { title: { type: "string" }, client: { type: "string" }, content: { type: "string", contentMediaType: "text/markdown" } },
    required: ["title", "content"], ...extra,
  }),
  [`patterns/${folder}/case-study/case-study.json`]: json({ title: "Sample", client: "A client", content: "<p>Sample text</p>" }),
});

let n = 0;
async function project(files: Record<string, string>): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries({ ...PAGE_LAYOUT, "pages/index.md": "---\ntitle: Home\n---\n\nHome.\n", ...files })) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  return root;
}
async function assembled(root: string, route: string) {
  const patterns = join(root, "patterns");
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const a: PageAssembly = {
    discoveryMap, handleMap, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap),
    render: createRenderer({ patternsDir: patterns, discoveryMap, handleMap }), shown: p => p.slice(root.length + 1), site: undefined,
    workbenchUrl: "https://wb.test/", head: async () => "", image: async () => ({ ok: true }),
  };
  return { page: await assemblePage(route, await readPages(join(root, "pages")), a), discoveryMap };
}
const WORK = "---\nlayout: case-study\ntitle: A site rebuilt\nclient: example.com\n---\n\nThe **work**, in markdown.\n";

describe("a marked pattern as a layout", () => {
  for (const folder of ["templates", "pages", "04-templates", "05-pages"]) {
    it(`a ${folder}/ pattern with x-pd-layout serves a page, its markdown in its x-pd-content slot`, async () => {
      const root = await project({ ...CASE_STUDY(folder), "pages/work.md": WORK });
      const { page, discoveryMap } = await assembled(root, "/work/");
      expect(page.problems).toEqual([]);
      expect(page.html).toContain(`<main class="case-study"><h1>A site rebuilt</h1><p class="client">example.com</p><div class="content"><p>The <strong>work</strong>, in markdown.</p>`);
      const index = await layoutIndex(discoveryMap);
      expect(index.idOf("case-study")).toBe(`${folder}/case-study`);
      expect(index.nameOf(`${folder}/case-study`)).toBe("case-study");
      expect(index.names).toEqual(["case-study", "page"]);
    });
  }

  it("a page can't set the slot, and the slot is not required of it", async () => {
    const root = await project({ ...CASE_STUDY("templates"), "pages/work.md": "---\nlayout: case-study\ntitle: T\ncontent: mine\n---\n\nBody.\n" });
    const { page } = await assembled(root, "/work/");
    expect(page.problems).toEqual([`work.md:4: "content" is filled by Pattern Dump with the page's markdown (x-pd-content of layout "case-study"), not by a page`]);
  });

  it("a slot that isn't markdown is a problem on the page", async () => {
    const root = await project({
      ...CASE_STUDY("templates", { properties: { title: { type: "string" }, content: { type: "string" } } }),
      "pages/work.md": "---\nlayout: case-study\ntitle: T\n---\n\nBody.\n",
    });
    const { page } = await assembled(root, "/work/");
    expect(page.problems).toContain(`work.md: layout "case-study" puts the page's markdown into "content" (x-pd-content), which must be a string with "contentMediaType": "text/markdown"`);
  });

  it("a key the build owns stays refused, as for any layout", async () => {
    const root = await project({
      ...CASE_STUDY("templates", { properties: { title: { type: "string" }, image: { type: "string" }, content: { type: "string", contentMediaType: "text/markdown" } } }),
      "pages/work.md": "---\nlayout: case-study\ntitle: T\n---\n\nBody.\n",
    });
    const { page } = await assembled(root, "/work/");
    expect(page.problems).toContain(`work.md: layout "case-study" declares "image", which a page sets for the build, not for its layout: rename it in the layout's schema`);
  });
});

describe("where x-pd-layout may not be", () => {
  it("outside pages/ and templates/ it makes no layout, and says so on the component", async () => {
    const root = await project({ ...CASE_STUDY("organisms"), "pages/work.md": WORK });
    const { page, discoveryMap } = await assembled(root, "/work/");
    expect(page.problems.some(p => p.includes(`layout "case-study" is not a layout`))).toBe(true);
    expect((await layoutIndex(discoveryMap)).problemsOf("organisms/case-study", p => p)).toEqual([
      "x-pd-layout makes a page or template pattern a layout; organisms/case-study is in neither pages/ nor templates/, so it is no layout: move it there, or include it in one that is",
    ]);
  });

  it("on a layouts/ component it would be a second name: a problem, and the folder's name stands", async () => {
    const root = await project({ "patterns/layouts/doc/doc.hbs": "<main>{{{body}}}</main>", "patterns/layouts/doc/doc.schema.json": json({ "x-pd-layout": "guide" }) });
    const { discoveryMap } = await assembled(root, "/");
    const index = await layoutIndex(discoveryMap);
    expect(index.has("doc")).toBe(true);
    expect(index.has("guide")).toBe(false);
    expect(index.problemsOf("layouts/doc", p => p)).toEqual([
      `layouts/doc is the layout "doc" by its folder, and x-pd-layout would give it a second name ("guide"): remove x-pd-layout`,
    ]);
  });

  it("a variant is never a layout: the schema is the base's", async () => {
    const root = await project({ ...CASE_STUDY("templates"), "patterns/templates/case-study/case-study~short.json": json({ title: "Short" }) });
    const { discoveryMap } = await assembled(root, "/");
    expect((await layoutIndex(discoveryMap)).entries().map(e => e.id)).toEqual(["layouts/page", "templates/case-study"]);
  });
});

describe("one name, two layouts", () => {
  it("a marked pattern and a layouts/ component: the name is no layout, and both files are named", async () => {
    const root = await project({
      ...CASE_STUDY("templates"),
      "patterns/layouts/case-study/case-study.hbs": "<main>{{{body}}}</main>",
      "pages/work.md": WORK,
    });
    const { page, discoveryMap } = await assembled(root, "/work/");
    const clash = `layout "case-study" is set twice: patterns/layouts/case-study/case-study.hbs (a layouts/ folder) and `
      + `patterns/templates/case-study/case-study.schema.json (x-pd-layout): rename one`;
    expect(page.problems).toContain(`work.md:2: layout "case-study" is not a layout: ${clash}`);
    const index = await layoutIndex(discoveryMap);
    expect(index.has("case-study")).toBe(false);
    expect(index.problemsOf("templates/case-study", p => p.slice(root.length + 1))).toEqual([clash]);
    expect(index.problemsOf("layouts/case-study", p => p.slice(root.length + 1))).toEqual([clash]);
  });

  it("two marked patterns: the same", async () => {
    const root = await project({ ...CASE_STUDY("templates"), ...CASE_STUDY("pages") });
    const { discoveryMap } = await assembled(root, "/");
    const index = await layoutIndex(discoveryMap);
    expect(index.has("case-study")).toBe(false);
    expect(index.clash("case-study", p => p.slice(root.length + 1))).toBe(`layout "case-study" is set twice: `
      + `patterns/pages/case-study/case-study.schema.json (x-pd-layout) and patterns/templates/case-study/case-study.schema.json (x-pd-layout): rename one`);
  });
});
