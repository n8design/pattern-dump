// Queries: every list of pages that isn't a folder's own listing. A layout names one as a sub-key of page with
// x-pd-query and its defaults; a page overrides options in a block under the query's name (`related:` with `  limit: 5` indented under it), or
// turns it off with `<name>: false`.
// The layout gets { entries, listing }: the pages, and the same through the query's view. Hand-picked pages come
// first, then the pages of the collections that match the categories and tags, sorted, to the limit. The current
// page, drafts and scheduled pages never appear, and a page never comes twice. Every value is checked.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

const md = (title: string, extra = "", body = `Body of ${title}.`): string => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;
const json = (v: unknown) => JSON.stringify(v);
const FIELDS = { route: { type: "string" }, title: { type: "string" }, date: { type: ["string", "null"] }, image: { type: ["string", "null"] } };
const RELATED = { collections: "same", sort: "relevance", limit: 3, view: "list" };

/** The layout prints the entries' titles (R[...]) and the listing (L[...]), so each case reads both. */
const articleLayout = (query: unknown, extra: Record<string, unknown> = {}) => ({
  "layouts/article/article.hbs": `<main><h1>{{title}}</h1>R[{{#each page.related.entries}}{{title}};{{/each}}]L[{{{page.related.listing}}}]</main>`,
  "layouts/article/article.schema.json": json({ properties: { title: { type: "string" }, page: { type: "object", properties: { related: { "x-pd-query": query, ...extra } } } } }),
});
const SKIN: Record<string, string> = {
  "layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>`,
  "layouts/page/page.schema.json": json({ properties: { title: { type: "string" } } }),
  "layouts/home/home.hbs": `<main><h1>{{title}}</h1>R[{{#each page.latest.entries}}{{title}};{{/each}}]</main>`,
  "layouts/home/home.schema.json": json({ properties: { title: { type: "string" }, page: { type: "object", properties: { latest: { "x-pd-query": { sort: "date", limit: 2 } } } } } }),
  ...articleLayout(RELATED),
  "components/list-card/list-card.hbs": `<a href="{{route}}">{{title}}</a>`,
  "components/list-card/list-card.schema.json": json({ required: ["route", "title"], properties: FIELDS }),
  "components/grid-card/grid-card.hbs": `<a href="{{route}}">{{title}} [{{image}}]</a>`,
  "components/grid-card/grid-card.schema.json": json({ required: ["route", "title", "image"], properties: FIELDS }),
  "views/list/list.hbs": `<ul class="view-list">{{#each entries}}<li>{{> components-list-card }}</li>{{/each}}</ul>`,
  "views/list/list.schema.json": json({ properties: { entries: { type: "array", "x-pd-card": "components/list-card" } } }),
  "views/grid/grid.hbs": `<ul class="view-grid">{{#each entries}}<li>{{> components-grid-card }}</li>{{/each}}</ul>`,
  "views/grid/grid.schema.json": json({ properties: { entries: { type: "array", "x-pd-card": "components/grid-card" } } }),
};
const CATEGORIES = { guides: { label: "Guides" }, design: { label: "Design", aliases: ["ds"] } };

/** The site: four articles and a note, each with its tags and categories. `a` is the page most cases open. */
const site = (a = "", extra: Record<string, string> = {}): Record<string, string> => ({
  "index.md": md("Home", "layout: home\n"),
  "about.md": md("About"),
  "articles/index.md": md("Articles", "childLayout: article\n"),
  "articles/a.md": md("Alpha", `date: 2026-11-03\ntags: [css, grid]\ncategories: [guides]\n${a}`),
  "articles/b.md": md("Bravo", "date: 2026-11-02\ntags: [css]\ncategories: [design]\n"),
  "articles/c.md": md("Charlie", "date: 2026-11-01\ntags: [grid]\ncategories: [design, guides]\n"),
  "articles/d.md": md("Delta", "date: 2026-10-01\n"),
  "notes/index.md": md("Notes"),
  "notes/n.md": md("November", "layout: article\ndate: 2026-11-04\ntags: [css]\n"),
  ...extra,
});

async function assemble(route: string, pages: Record<string, string>, o: { skin?: Record<string, string>; build?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pd-query-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(o.skin ?? SKIN)) await save(join(root, "patterns", ...rel.split("/")), body);
  for (const [rel, body] of Object.entries(pages)) await save(join(root, "pages", ...rel.split("/")), body);
  const dir = join(root, "patterns");
  const { discoveryMap, handleMap } = await buildDiscoveryMap(dir);
  const render = createRenderer({ patternsDir: dir, discoveryMap, handleMap });
  const heads: string[][] = [];
  const leave = o.build ? "leave-out" : "show";
  const model = await readPages(join(root, "pages"), { drafts: leave, scheduled: leave, today: "2026-11-15", categories: CATEGORIES });
  const page = await assemblePage(route, model, {
    discoveryMap, handleMap, composition: await buildCompositionRegistry(dir, handleMap, discoveryMap),
    site: undefined, workbenchUrl: "https://wb.example/", shown: p => p,
    head: async (_layout, _html, placed) => { heads.push([...placed]); return ""; },
    image: async () => ({ ok: false, message: "no images here" }), render,
    ...(o.build ? {} : { live: { wsPort: 1, generation: "" } }),
  } as PageAssembly);
  const titles = /R\[([^\]]*)\]/.exec(page.html)?.[1]?.split(";").filter(Boolean) ?? null;
  const listing = /L\[([\s\S]*?)\]<\/main>/.exec(page.html)?.[1] ?? null;
  return { ...page, titles, listing, placed: heads.at(-1) ?? [] };
}

describe("a query's pages", () => {
  it("takes the layout's defaults: the same folder, most relevant first, to the limit, through the view", async () => {
    const p = await assemble("/articles/a/", site());
    expect(p.problems).toEqual([]);
    // Charlie shares grid and guides (2), Bravo css (1), Delta nothing; Alpha is the page itself.
    expect(p.titles).toEqual(["Charlie", "Bravo", "Delta"]);
    expect(p.listing).toBe(`<ul class="view-list"><li><a href="/articles/c/">Charlie</a></li><li><a href="/articles/b/">Bravo</a></li><li><a href="/articles/d/">Delta</a></li></ul>`);
    expect(p.placed).toContain("views/list");
  });

  it("sorts by date, newest first, or oldest first with order: asc", async () => {
    expect((await assemble("/articles/a/", site("related:\n  sort: date\n"))).titles).toEqual(["Bravo", "Charlie", "Delta"]);
    expect((await assemble("/articles/a/", site("related:\n  sort: date\n  order: asc\n"))).titles).toEqual(["Delta", "Charlie", "Bravo"]);
  });

  it("sorts by title, A to Z, or Z to A with order: desc", async () => {
    expect((await assemble("/articles/a/", site("related:\n  sort: title\n"))).titles).toEqual(["Bravo", "Charlie", "Delta"]);
    expect((await assemble("/articles/a/", site("related:\n  sort: title\n  order: desc\n"))).titles).toEqual(["Delta", "Charlie", "Bravo"]);
  });

  it("stops at the limit", async () => {
    expect((await assemble("/articles/a/", site("related:\n  limit: 1\n"))).titles).toEqual(["Charlie"]);
  });

  it("puts hand-picked pages first, in their order, and never repeats one", async () => {
    const p = await assemble("/articles/a/", site("related:\n  pages: [notes/n.md, articles/d.md]\n"));
    expect(p.problems).toEqual([]);
    expect(p.titles).toEqual(["November", "Delta", "Charlie"]);
  });

  it("lists the collections named, and every folder without any", async () => {
    expect((await assemble("/articles/a/", site("related:\n  collections: notes\n"))).titles).toEqual(["November"]);
    // November shares css (1) and is newer than Bravo (1).
    expect((await assemble("/articles/a/", site("related:\n  collections: [articles, notes]\n"))).titles).toEqual(["Charlie", "November", "Bravo"]);
    // The home page's latest: no collections, by date, two.
    expect((await assemble("/", site())).titles).toEqual(["November", "Alpha"]);
  });

  it("keeps the pages with any of the tags, or with all of them", async () => {
    const note = (q: string) => site("", { "notes/n.md": md("November", `layout: article\ndate: 2026-11-04\ntags: [css]\nrelated:\n  collections: articles\n${q}`) });
    expect((await assemble("/notes/n/", note("  tags: [grid]\n"))).titles).toEqual(["Alpha", "Charlie"]);
    expect((await assemble("/notes/n/", note("  tags: [css, grid]\n  match: all\n"))).titles).toEqual(["Alpha"]);
    expect((await assemble("/notes/n/", note("  tags: [css, grid]\n  match: any\n"))).titles).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("keeps the pages in the categories, an old key with a warning", async () => {
    expect((await assemble("/articles/a/", site("related:\n  categories: design\n"))).titles).toEqual(["Charlie", "Bravo"]);
    expect((await assemble("/articles/a/", site("related:\n  categories: [design, guides]\n  match: all\n"))).titles).toEqual(["Charlie"]);
    const old = await assemble("/articles/a/", site("related:\n  categories: ds\n"));
    expect(old.titles).toEqual(["Charlie", "Bravo"]);
    expect(old.notes).toContain(`warning: articles/a.md:7: category "ds" is now "design" (renamed in storefront.categories): write "design"`);
  });

  it("is off with related: false: no pages, no listing", async () => {
    const p = await assemble("/articles/a/", site("related: false\n"));
    expect(p.problems).toEqual([]);
    expect(p.titles).toEqual([]);
    expect(p.listing).toBe("");
    expect(p.placed).not.toContain("views/list");
  });

  it("has no listing when no page matches", async () => {
    const p = await assemble("/articles/a/", site("related:\n  tags: [css]\n  collections: notes\n  match: all\n  categories: guides\n"));
    expect(p.problems).toEqual([]);
    expect(p.titles).toEqual([]);
    expect(p.listing).toBe("");
  });

  it("never lists a draft or a scheduled page, in pd dev either", async () => {
    const extra = { "articles/e.md": md("Echo", "date: 2026-11-10\ndraft: true\ntags: [grid]\n"), "articles/f.md": md("Foxtrot", "date: 2999-01-01\ntags: [grid]\n") };
    expect((await assemble("/articles/a/", site("related:\n  limit: 9\n", extra))).titles).toEqual(["Charlie", "Bravo", "Delta"]);
    expect((await assemble("/articles/a/", site("related:\n  limit: 9\n", extra), { build: true })).titles).toEqual(["Charlie", "Bravo", "Delta"]);
  });

  it("a hand-picked draft or scheduled page: a warning in pd dev, a problem in pd build", async () => {
    const extra = { "articles/e.md": md("Echo", "draft: true\n"), "articles/f.md": md("Foxtrot", "date: 2999-01-01\n") };
    const pick = site("related:\n  pages: [articles/e.md, articles/f.md]\n", extra);
    const dev = await assemble("/articles/a/", pick);
    expect(dev.problems).toEqual([]);
    expect(dev.titles).toEqual(["Charlie", "Bravo", "Delta"]);
    expect(dev.notes).toEqual(expect.arrayContaining([
      `warning: articles/a.md:7: pages lists "articles/e.md", which is a draft, so pd build leaves it out; it is not listed`,
      `warning: articles/a.md:7: pages lists "articles/f.md", which is scheduled for 2999-01-01, so pd build leaves it out; it is not listed`,
    ]));
    const build = await assemble("/articles/a/", pick, { build: true });
    expect(build.problems).toEqual([
      `articles/a.md:7: pages lists "articles/e.md", which is a draft, so pd build leaves it out: publish it first, or take it out of the list`,
      `articles/a.md:7: pages lists "articles/f.md", which is scheduled for 2999-01-01, so pd build leaves it out: publish it first, or take it out of the list`,
    ]);
  });

  it("gives a layout that writes its own markup the entries, checked against the card it names", async () => {
    const skin = { ...SKIN, ...articleLayout({ collections: "same" }, { properties: { entries: { "x-pd-card": "components/grid-card" } } }) };
    const p = await assemble("/articles/a/", site("", { "articles/b.md": md("Bravo", "date: 2026-11-02\nimage: /assets/images/b.jpg\n") }), { skin });
    expect(p.problems).toEqual([
      `articles/a.md: articles/c.md has no image, which the card of page.related (components/grid-card) requires: give it one (image: /assets/images/<name>.jpg, a raster image in the assets)`,
      `articles/a.md: articles/d.md has no image, which the card of page.related (components/grid-card) requires: give it one (image: /assets/images/<name>.jpg, a raster image in the assets)`,
    ]);
  });

  it("checks each page against its view's card", async () => {
    const p = await assemble("/articles/a/", site("related:\n  view: grid\n"));
    expect(p.problems).toEqual([
      `articles/a.md: articles/c.md has no image, which the card of view "grid" (components/grid-card) requires: give it one (image: /assets/images/<name>.jpg, a raster image in the assets)`,
      `articles/a.md: articles/b.md has no image, which the card of view "grid" (components/grid-card) requires: give it one (image: /assets/images/<name>.jpg, a raster image in the assets)`,
      `articles/a.md: articles/d.md has no image, which the card of view "grid" (components/grid-card) requires: give it one (image: /assets/images/<name>.jpg, a raster image in the assets)`,
    ]);
  });
});

describe("a query's values, checked", () => {
  const fails = async (extra: string) => (await assemble("/articles/a/", site(extra))).problems;

  it("a hand-picked page that is no page, listed twice, or more than the limit", async () => {
    expect(await fails("related:\n  pages: [articles/dd.md]\n")).toEqual([
      `articles/a.md:7: pages lists "articles/dd.md", which is no page: did you mean "articles/d.md"? (a page's path in the pages folder, such as "articles/a.md")`,
    ]);
    expect(await fails("related:\n  pages: [articles/d.md, articles/d.md]\n")).toEqual([`articles/a.md:7: pages lists "articles/d.md" twice`]);
    expect(await fails("related:\n  pages: [articles/b.md, articles/c.md]\n  limit: 1\n")).toEqual([
      `articles/a.md:7: pages lists 2 pages, more than the limit of 1 (articles/a.md:8): raise the limit, or pick fewer`,
    ]);
  });

  it("an unknown collection, an undeclared category, a tag no page has", async () => {
    expect(await fails("related:\n  collections: artcles\n")).toEqual([`articles/a.md:7: collections names "artcles", which is no folder of the pages: did you mean "articles"?`]);
    expect(await fails("related:\n  collections: blog\n")).toEqual([`articles/a.md:7: collections names "blog", which is no folder of the pages: the folders are "articles", "notes", or "same"`]);
    expect(await fails("related:\n  categories: desgin\n")).toEqual([`articles/a.md:7: categories: "desgin" is not a category: did you mean "design"?`]);
    expect(await fails("related:\n  tags: csss\n")).toEqual([`articles/a.md:7: no page has the tag "csss": did you mean "css"?`]);
  });

  it("an unknown sort, match or order, and order with relevance", async () => {
    expect(await fails("related:\n  sort: relavance\n")).toEqual([`articles/a.md:7: sort "relavance" is not "relevance", "date" or "title": did you mean "relevance"?`]);
    expect(await fails("related:\n  match: every\n")).toEqual([`articles/a.md:7: match "every" is not "any" or "all"`]);
    expect(await fails("related:\n  sort: date\n  order: up\n")).toEqual([`articles/a.md:8: order "up" is not "asc" or "desc"`]);
    expect(await fails("related:\n  order: asc\n")).toEqual([
      `articles/a.md:7: order doesn't go with sort: relevance, which always puts the most relevant first: leave order out, or sort by date or title`,
    ]);
  });

  it("a limit that isn't a whole number from 1", async () => {
    for (const bad of ["0", "three", "1.5", "-2"]) {
      expect(await fails(`related:\n  limit: ${bad}\n`)).toEqual([`articles/a.md:7: limit "${bad}" is not a number of pages: a whole number from 1, such as 3`]);
    }
  });

  it("a view that isn't one", async () => {
    expect(await fails("related:\n  view: lsit\n")).toEqual([`articles/a.md:7: view "lsit" is not a view: did you mean "list"? (the views are "grid", "list")`]);
  });

  it("a related value that is neither true, false nor options; an option there isn't; a value of the wrong type", async () => {
    for (const bad of ["[articles/b.md]", "maybe"]) {
      expect(await fails(`related: ${bad}\n`)).toEqual([
        `articles/a.md:6: related must be true, false (no related on this page), or its options indented under it, such as\nrelated:\n  limit: 5`,
      ]);
    }
    expect(await fails("related: true\n")).toEqual([]);
    expect(await fails("related:\n  limt: 2\n")).toEqual([
      `articles/a.md:7: "limt" is not an option of related: did you mean "limit"? (pages, collections, categories, tags, match, sort, order, limit, view)`,
    ]);
    // A wrong type says what is allowed.
    expect(await fails("related:\n  limit: [3]\n")).toEqual([`articles/a.md:7: limit ["3"] is not a number of pages: a whole number from 1, such as 3`]);
    expect(await fails("related:\n  sort: [date, title]\n")).toEqual([`articles/a.md:7: sort ["date","title"] is not "relevance", "date" or "title"`]);
    expect(await fails("related:\n  view: [list]\n")).toEqual([`articles/a.md:7: view must be one view's name, such as "compact"`]);
  });

  it("takes options indented under a query only: a block under another key fails, an unknown one with a did you mean", async () => {
    expect(await fails("title2:\n  x: y\n")).toEqual([`articles/a.md:6: "title2" is not declared by layout "article" (the childLayout of articles/index.md): did you mean "title"?`]);
    expect(await fails("relatd:\n  limit: 2\n")).toEqual([`articles/a.md:6: "relatd" is not declared by layout "article" (the childLayout of articles/index.md): did you mean "related"?`]);
    expect(await fails("image:\n  x: y\n")).toEqual([`articles/a.md:6: "image" has keys indented under it, which only a query of the layout takes: write its value on the line`]);
  });

  it("the layout's own declaration: an unknown option, an unknown value, a name Pattern Dump fills", async () => {
    const unknown = await assemble("/articles/a/", site(), { skin: { ...SKIN, ...articleLayout({ ...RELATED, limt: 3, sort: "newest" }) } });
    expect(unknown.problems).toEqual([
      `layouts/article (x-pd-query of page.related): "limt" is not an option of a query: did you mean "limit"? (pages, collections, categories, tags, match, sort, order, limit, view)`,
      `layouts/article (x-pd-query of page.related): sort "newest" is not "relevance", "date" or "title"`,
    ]);
    const taken = await assemble("/articles/a/", site(), { skin: { ...SKIN,
      "layouts/article/article.schema.json": json({ properties: { title: { type: "string" }, page: { type: "object", properties: { children: { "x-pd-query": { limit: 2 } } } } } }) } });
    expect(taken.problems).toEqual([`layouts/article: page.children is filled by Pattern Dump, so it can't be a query: give the query another name`]);
    const clash = await assemble("/articles/a/", site(), { skin: { ...SKIN,
      "layouts/article/article.schema.json": json({ properties: { title: { type: "string" }, related: { type: "string" }, page: { type: "object", properties: { related: { "x-pd-query": {} } } } } }) } });
    expect(clash.problems).toEqual([`layouts/article: page.related: a page sets the query under "related", which is already a key of the page: give the query another name`]);
  });

  it("keeps a layout's sample data for a query to entries and listing", async () => {
    const p = await assemble("/articles/a/", site(), { skin: { ...SKIN,
      "layouts/article/article.json": json({ title: "T", page: { related: { entries: [{ route: "/x/", title: "X", rating: 4 }], listing: "<ul></ul>", heading: "More" } } }) } });
    expect(p.problems).toEqual([
      `the sample data of layouts/article (article.json) sets "page.related.entries[0].rating", which is not part of the page data Pattern Dump fills, so it would show on every page using layouts/article`,
      `the sample data of layouts/article (article.json) sets "page.related.heading", which is not part of the page data Pattern Dump fills, so it would show on every page using layouts/article`,
    ]);
  });
});
