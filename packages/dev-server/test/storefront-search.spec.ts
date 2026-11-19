// Search (search.ts): what a page gives the index (its own content, never the layout's), which pages give nothing,
// the document Pagefind is given, the index's files, and how storefront.search finds Pagefind.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorefrontCategory } from "@pattern-dump/config";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { readPages } from "../src/storefront/pages.js";
import { buildCompositionRegistry } from "../src/composition.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { buildSearchIndex, loadProjectPagefind, searchDocument, searchPagefind, SearchUnavailableError, type PagefindModule, type SearchRecord } from "../src/storefront/search.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

const page = (title: string, extra = "", body = `Body of ${title}.`): string => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;

// A layout with text of its own around the body, and a related-pages listing of other pages' titles and teasers.
const PAGE_LAYOUT = "<header><nav>Layoutheader</nav></header><main><h1>{{title}}</h1>{{{body}}}"
  + "<aside>{{{page.related.listing}}}</aside></main><footer>Layoutfooter</footer>";
const PAGE_SCHEMA = { properties: { title: { type: "string" }, description: { type: "string" }, page: { type: "object", properties: {
  related: { "x-pd-query": { collections: ["articles"], limit: 5, view: "list" } },
} } } };
const VIEW = { hbs: "<ul>{{#each entries}}<li>{{title}}: {{description}}</li>{{/each}}</ul>", schema: { properties: { entries: { type: "array", "x-pd-card": "cards/entry", items: {} } } } };
const CARD = { hbs: "<b>{{title}}</b>", schema: { properties: { title: { type: "string" }, description: { type: ["string", "null"] } } } };

async function site(files: Record<string, string>, o: { categories?: Record<string, StorefrontCategory> } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pd-search-"));
  roots.push(root);
  const patterns = join(root, "patterns");
  const all: Record<string, string> = {
    "layouts/page/page.hbs": PAGE_LAYOUT,
    "layouts/page/page.schema.json": JSON.stringify(PAGE_SCHEMA),
    "layouts/tag/tag.hbs": "<main><h1>{{title}}</h1>{{{page.pages.listing}}}</main>",
    "layouts/tag/tag.schema.json": JSON.stringify({ properties: { title: { type: "string" }, page: { type: "object", properties: { pages: { "x-pd-query": { tags: "same" } } } } } }),
    "views/list/list.hbs": VIEW.hbs, "views/list/list.schema.json": JSON.stringify(VIEW.schema),
    "cards/entry/entry.hbs": CARD.hbs, "cards/entry/entry.schema.json": JSON.stringify(CARD.schema),
  };
  for (const [rel, body] of Object.entries(all)) await save(join(patterns, ...rel.split("/")), body);
  for (const [rel, body] of Object.entries(files)) await save(join(root, "pages", ...rel.split("/")), body);
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
  const model = await readPages(join(root, "pages"), {
    categories: o.categories, layouts: new Set([...discoveryMap.keys()].filter(id => id.startsWith("layouts/")).map(id => id.slice("layouts/".length))),
    drafts: "leave-out", scheduled: "leave-out", today: "2026-11-16",
  });
  const composition = await buildCompositionRegistry(patterns, handleMap, discoveryMap);
  const assemble = (route: string, extra: Partial<PageAssembly> = {}) => assemblePage(route, model, {
    discoveryMap, handleMap, composition, site: undefined, workbenchUrl: "https://wb.example/", shown: x => x, head: async () => "",
    image: async () => ({ ok: false, message: "no images here" }), render, lang: "en", ...extra,
  } as PageAssembly);
  return { model, assemble };
}

const ARTICLES = {
  "index.md": page("Home"),
  "about.md": page("About us"),
  "articles/index.md": page("Articles", "", "All the articles."),
  "articles/grids.md": page("Grids", "description: Laying out with grids\ntags: [css, layout]\ncategories: [guides]\n", "Zebracrossing in a grid.\n\n## Subgrid\n\nMore."),
  "articles/colour.md": page("Colour", "tags: [css]\nindex: false\n", "Colour body."),
};

describe("what a page gives the index", () => {
  it("its own body and title, its collection's label, its tags' and categories' labels, its teaser: not the layout's text", async () => {
    const s = await site(ARTICLES, { categories: { guides: { label: "How-to guides" } } });
    const p = await s.assemble("/articles/grids/");
    expect(p.problems).toEqual([]);
    // The page itself shows the layout's text and the related pages.
    expect(p.html).toContain("Layoutheader");
    expect(p.html).toContain("Colour");
    expect(p.search).toMatchObject({
      route: "/articles/grids/", title: "Grids", section: "Articles", tags: ["css", "layout"], categories: ["How-to guides"],
      teaser: "Laying out with grids", lang: "en",
    } satisfies Partial<SearchRecord>);
    expect(p.search!.body).toContain("Zebracrossing in a grid.");
    expect(p.search!.body).toContain(`id="subgrid"`);
    for (const word of ["Layoutheader", "Layoutfooter", "Colour", "<aside"]) expect(p.search!.body).not.toContain(word);
  });

  it("a folder's index page is in its own collection; a page at the top has none", async () => {
    const s = await site(ARTICLES);
    expect((await s.assemble("/articles/")).search).toMatchObject({ section: "Articles", body: expect.stringContaining("All the articles.") });
    expect((await s.assemble("/about/")).search).toMatchObject({ section: null });
  });

  it("nothing from the 404 page, a tag page, or a page with index: false", async () => {
    const s = await site(ARTICLES);
    const notFound = await s.assemble("/404.html");
    expect(notFound.status).toBe(404);
    expect(notFound.search).toBeUndefined();
    const tag = await s.assemble("/tags/css/");
    expect(tag.problems).toEqual([]);
    expect(tag.search).toBeUndefined();
    const hidden = await s.assemble("/articles/colour/");
    expect(hidden.problems).toEqual([]);
    expect(hidden.search).toBeUndefined();
  });
});

const RECORD: SearchRecord = { route: "/a/", title: "A & B", body: "<p>Text</p>", section: "Articles", tags: ["Design, Inc"], categories: [], teaser: null, lang: "de" };

describe("the document Pagefind is given", () => {
  it("title, meta and filters outside the indexed body; the title as <h1> when the body has none", () => {
    const d = searchDocument(RECORD);
    expect(d).toContain(`<html lang="de">`);
    expect(d).toContain(`<span data-pagefind-meta="title">A &amp; B</span>`);
    expect(d).not.toContain(`data-pagefind-meta="teaser"`);
    expect(d).toContain(`<span data-pagefind-filter="section">Articles</span><span data-pagefind-filter="tag">Design, Inc</span>`);
    expect(d).toContain(`<main data-pagefind-body>\n<h1>A &amp; B</h1>\n<p>Text</p>\n</main>`);
    expect(searchDocument({ ...RECORD, body: `<h1 id="x">Own</h1>` })).toContain(`<main data-pagefind-body>\n<h1 id="x">Own</h1>\n</main>`);
  });
});

describe("the index", () => {
  it("each page at its URL under the site's path, in route order", async () => {
    const added: string[] = [];
    let closed = false;
    const fake: PagefindModule = {
      createIndex: async () => ({ errors: [], index: {
        addHTMLFile: async f => { added.push(f.url); return { errors: [] }; },
        getFiles: async () => ({ errors: [], files: [{ path: "pagefind.js", content: new Uint8Array() }] }),
      } }),
      close: async () => { closed = true; },
    };
    await buildSearchIndex([{ ...RECORD, route: "/b/" }, { ...RECORD, route: "/" }, RECORD], fake, "/site/");
    expect(added).toEqual(["/site/", "/site/a/", "/site/b/"]);
    expect(closed).toBe(true);
  });

  it("with the project's Pagefind: its search files, not its own UIs", async () => {
    const pagefind = await loadProjectPagefind(process.cwd());
    expect(pagefind).toBeDefined();
    const files = await buildSearchIndex([RECORD, { ...RECORD, route: "/b/", lang: "en" }], pagefind!, "/");
    const names = [...files.keys()];
    expect(names).toContain("pagefind.js");
    expect(names).toContain("pagefind-entry.json");
    expect(names.some(n => n.startsWith("fragment/"))).toBe(true);
    expect(names.filter(n => /^pagefind-(?:ui|modular-ui|component-ui|highlight)\./.test(n))).toEqual([]);
  });
});

describe("site.search", () => {
  const none = async () => undefined;
  it("true without Pagefind stops, naming the install", async () => {
    const e = await searchPagefind(true, "/nowhere", none).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SearchUnavailableError);
    expect((e as Error).message).toBe("pd build: site.search is on, and this project has no Pagefind to build the index with: "
      + "npm install --save-dev pagefind (or set site.search to false)");
  });

  it("left out: Pagefind when the project has it, else no search and no stop; false never loads it", async () => {
    expect(await searchPagefind(undefined, "/nowhere", none)).toBeUndefined();
    const found = { createIndex: async () => ({ errors: [] }), close: async () => null } as PagefindModule;
    expect(await searchPagefind(undefined, "/x", async () => found)).toBe(found);
    expect(await searchPagefind(false, "/x", async () => { throw new Error("loaded"); })).toBeUndefined();
  });

  it("a project without Pagefind has none", async () => {
    expect(await loadProjectPagefind(await mkdtemp(join(tmpdir(), "pd-no-pf-")))).toBeUndefined();
  });
});
