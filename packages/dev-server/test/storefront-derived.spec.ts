// What a layout gets as `page` (derived.ts): only a layout that declares `page` gets it, with exactly the
// sub-keys it declares, each null where nothing is derived; a declared sub-key Pattern Dump does not fill
// is a problem naming the ones it does; and a page's frontmatter cannot set `page`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RenderInput } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage } from "../src/storefront/page.js";
import { checkPageDeclaration, FILLED, outsideShape, PAGE_SHAPE, pageValue } from "../src/storefront/derived.js";
import { save } from "../../../test-support/save.js";
import type { DatedPage, GitDates } from "../src/storefront/git-dates.js";

describe("checkPageDeclaration", () => {
  it("a layout that does not declare page declares nothing for it", () => {
    expect(checkPageDeclaration({ properties: { title: { type: "string" } } }, "layouts/doc")).toEqual({ declared: undefined, problems: [] });
    expect(checkPageDeclaration(undefined, "layouts/doc")).toEqual({ declared: undefined, problems: [] });
  });

  it("an undeclared sub-key (page.toc) is an error that names what Pattern Dump fills", () => {
    expect(checkPageDeclaration({ properties: { page: { type: "object", properties: { toc: {} } } } }, "layouts/doc", ["prev", "next"])).toEqual({
      declared: ["toc"],
      problems: [`layouts/doc declares "page.toc", which Pattern Dump does not fill (it fills page.prev, page.next)`],
    });
  });

  it("names what Pattern Dump fills today", () => {
    const all = "page.headings, page.section, page.breadcrumbs, page.prev, page.next, page.created, page.modified";
    expect(FILLED).toEqual(["headings", "section", "breadcrumbs", "prev", "next", "created", "modified"]);
    expect(checkPageDeclaration({ properties: { page: { properties: { toc: {} } } } }, "layouts/doc").problems).toEqual([
      `layouts/doc declares "page.toc", which Pattern Dump does not fill (it fills ${all})`,
    ]);
    expect(checkPageDeclaration({ properties: { page: { properties: { toc: {} } } } }, "layouts/doc", []).problems).toEqual([
      `layouts/doc declares "page.toc", which Pattern Dump does not fill (it fills none yet)`,
    ]);
  });

  it("a filled sub-key is no problem", () => {
    expect(checkPageDeclaration({ properties: { page: { properties: { prev: {} } } } }, "layouts/doc", ["prev"]))
      .toEqual({ declared: ["prev"], problems: [] });
  });
});

describe("pageValue", () => {
  it("a declared sub-key the page has no value for is null", () => {
    expect(pageValue(["prev", "created"], {})).toEqual({ prev: null, created: null });
    expect(pageValue(["prev"], { prev: null })).toEqual({ prev: null });
  });

  it("carries only the declared sub-keys, with their derived values", () => {
    expect(pageValue(["prev"], { prev: { route: "/a/", title: "A" }, next: { route: "/b/", title: "B" } }))
      .toEqual({ prev: { route: "/a/", title: "A" } });
  });
});

describe("outsideShape", () => {
  it("names every key outside the shape, at any depth", () => {
    expect(outsideShape({ prev: { route: "/", title: "T", extra: 1 }, foo: 1 }, PAGE_SHAPE, "page")).toEqual(["page.prev.extra", "page.foo"]);
    expect(outsideShape({ headings: [{ level: 2, text: "A", anchor: "a" }, { level: 2, x: 1 }] }, PAGE_SHAPE, "page")).toEqual(["page.headings[1].x"]);
    expect(outsideShape({ prev: { title: { deeper: 1 } } }, PAGE_SHAPE, "page")).toEqual(["page.prev.title.deeper"]);
  });

  it("accepts what is inside it", () => {
    expect(outsideShape({ prev: { title: "T" }, breadcrumbs: [{ route: "/", title: "Home" }], created: "2026-01-01" }, PAGE_SHAPE, "page")).toEqual([]);
  });
});

describe("assemblePage — page", () => {
  let tmp = "";
  beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-derived-")); });
  afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

  let n = 0;
  /** A one-layout project and one page; returns the page and the data the layout was rendered with. */
  const assemble = async (schema: unknown, frontmatter = "title: Home", markdown = "Hello.", dates?: GitDates) => {
    const dir = join(tmp, `p${n++}`);
    const patterns = join(dir, "patterns");
    for (const [rel, body] of Object.entries({
      "layouts/page/page.hbs": "<main><h1>{{title}}</h1>{{{body}}}</main>",
      "layouts/page/page.schema.json": JSON.stringify(schema),
    })) {
      await mkdir(dirname(join(patterns, rel)), { recursive: true });
      await save(join(patterns, rel), body);
    }
    await mkdir(join(dir, "pages"), { recursive: true });
    await save(join(dir, "pages", "index.md"), `---\n${frontmatter}\n---\n${markdown}\n`);
    const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
    const render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
    const inputs: RenderInput[] = [];
    const page = await assemblePage("/", await readPages(join(dir, "pages")), {
      discoveryMap, handleMap, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap),
      site: undefined, workbenchUrl: "https://wb.example/", shown: p => p, head: async () => "", ...(dates ? { dates } : {}),
      render: input => { inputs.push(input); return render(input); },
    });
    return { page, data: inputs.at(-1)?.data as Record<string, unknown> | undefined };
  };

  it("a layout that does not declare page gets no page", async () => {
    const { page, data } = await assemble({ properties: { title: { type: "string" } } });
    expect(page.status).toBe(200);
    expect(data).toBeDefined();
    expect(Object.hasOwn(data!, "page")).toBe(false);
  });

  it("a layout that declares page gets it, with only the sub-keys it declares", async () => {
    const { page, data } = await assemble({ properties: { title: { type: "string" }, page: { type: "object", properties: {} } } });
    expect(page.status).toBe(200);
    expect(data!["page"]).toEqual({});
  });

  it("a declared sub-key Pattern Dump does not fill fails the page, named", async () => {
    const { page } = await assemble({ properties: { title: { type: "string" }, page: { type: "object", properties: { toc: { type: "array" } } } } });
    expect(page.status).toBe(500);
    expect(page.problems).toEqual([`layouts/page declares "page.toc", which Pattern Dump does not fill (it fills page.headings, page.section, page.breadcrumbs, page.prev, page.next, page.created, page.modified)`]);
  });

  it("a layout that declares page.headings gets every heading, with the anchor its id carries", async () => {
    const { page, data } = await assemble({ properties: { title: { type: "string" }, page: { type: "object", properties: { headings: { type: "array" } } } } },
      "title: Home", "## Pages\n\n### Größe & Übersicht\n\n## Pages\n");
    expect(page.status).toBe(200);
    expect(data!["page"]).toEqual({ headings: [
      { level: 2, text: "Pages", anchor: "pages" },
      { level: 3, text: "Größe & Übersicht", anchor: "größe--übersicht" },
      { level: 2, text: "Pages", anchor: "pages-1" },
    ] });
    expect(page.html).toContain(`<h2 id="pages">Pages</h2>`);
    expect(page.html).toContain(`<h3 id="größe--übersicht">Größe &amp; Übersicht</h3>`);
    expect(page.html).toContain(`<h2 id="pages-1">Pages</h2>`);
  });

  it("a layout that declares the position gets it: on the only page, no neighbours, its own section", async () => {
    const link = { type: "object", properties: { route: { type: "string" }, title: { type: "string" } } };
    const { page, data } = await assemble({ properties: { title: { type: "string" }, page: { type: "object", properties: {
      section: link, breadcrumbs: { type: "array", items: link }, prev: link, next: link,
    } } } });
    expect(page.status).toBe(200);
    expect(data!["page"]).toEqual({ section: { route: "/", title: "Home" }, breadcrumbs: [], prev: null, next: null });
  });

  describe("dates", () => {
    const DATED = { properties: { title: { type: "string" }, page: { type: "object", properties: { created: { type: "string" }, modified: { type: "string" } } } } };
    const fake = (dated: DatedPage) => {
      const asked: string[] = [];
      const dates: GitDates = { of: async (path, mode) => { asked.push(`${path} ${mode}`); return dated; }, statusChanged: () => {} };
      return { dates, asked };
    };

    it("a layout that declares them gets the page's dates, and their notes", async () => {
      const f = fake({ dates: { created: "2026-01-10T10:00:00+01:00", modified: "2026-02-10T10:00:00+01:00" }, notes: ["index.md: a note"], problems: [] });
      const { page, data } = await assemble(DATED, "title: Home", "Hello.", f.dates);
      expect(page.status).toBe(200);
      expect(data!["page"]).toEqual({ created: "2026-01-10T10:00:00+01:00", modified: "2026-02-10T10:00:00+01:00" });
      expect(page.notes).toEqual(["index.md: a note"]);
      expect(f.asked).toEqual(["index.md build"]);
    });

    it("a problem with them (pd build from a shallow clone) fails the page", async () => {
      const f = fake({ dates: { created: "x", modified: "x" }, notes: [], problems: ["index.md: the repository is a shallow clone"] });
      const { page } = await assemble(DATED, "title: Home", "Hello.", f.dates);
      expect(page.status).toBe(500);
      expect(page.problems).toEqual(["index.md: the repository is a shallow clone"]);
    });

    it("a layout that declares none never asks for them", async () => {
      const f = fake({ dates: { created: "x", modified: "x" }, notes: [], problems: [] });
      const { page } = await assemble({ properties: { title: { type: "string" }, page: { type: "object", properties: { headings: {} } } } }, "title: Home", "Hello.", f.dates);
      expect(page.status).toBe(200);
      expect(f.asked).toEqual([]);
    });
  });

  it("a page with no headings gets an empty list", async () => {
    const { data } = await assemble({ properties: { title: { type: "string" }, page: { type: "object", properties: { headings: { type: "array" } } } } });
    expect(data!["page"]).toEqual({ headings: [] });
  });

  it("a page's frontmatter cannot set page", async () => {
    const { page } = await assemble({ properties: { title: { type: "string" }, page: { type: "object", properties: {} } } }, "title: Home\npage: x");
    expect(page.status).toBe(500);
    expect(page.problems).toEqual([`index.md:3: "page" is filled by the storefront, not by a page`]);
  });
});
