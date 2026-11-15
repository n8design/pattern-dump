// Listing views: a folder's index.md names how its listing is shown (`view: grid`), and the view is a component in
// the skin's views/ folder. Pattern Dump has none of its own. Its layout declares page.listing and writes it
// unescaped; Pattern Dump renders the view once with the folder's pages as `entries` and passes the HTML. The view's
// schema names its card (x-pd-card on `entries`), and every page is checked against that card's schema, so a grid
// whose card requires an image reports the pages without one.
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

const SKIN: Record<string, string> = {
  "layouts/listing/listing.hbs": `<main><h1>{{title}}</h1>{{{page.listing}}}</main>`,
  "layouts/listing/listing.schema.json": json({ properties: { title: { type: "string" }, page: { type: "object", properties: { listing: {} } } } }),
  "layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>`,
  "layouts/page/page.schema.json": json({ properties: { title: { type: "string" } } }),
  // Two cards: one for every page, one that needs an image.
  "components/list-card/list-card.hbs": `<a href="{{route}}">{{title}}</a>`,
  "components/list-card/list-card.schema.json": json({ required: ["route", "title"], properties: FIELDS }),
  "components/grid-card/grid-card.hbs": `<a href="{{route}}">{{title}} [{{image}}]</a>`,
  "components/grid-card/grid-card.schema.json": json({ required: ["route", "title", "image"], properties: FIELDS }),
  "views/list/list.hbs": `<ul class="view-list">{{#each entries}}<li>{{> components-list-card }}</li>{{/each}}</ul>`,
  "views/list/list.schema.json": json({ properties: { entries: { type: "array", "x-pd-card": "components/list-card" } } }),
  "views/grid/grid.hbs": `<ul class="view-grid">{{#each entries}}<li>{{> components-grid-card }}</li>{{/each}}</ul>`,
  "views/grid/grid.schema.json": json({ properties: { entries: { type: "array", "x-pd-card": "components/grid-card" } } }),
};
const pagesWith = (indexExtra: string, extra: Record<string, string> = {}) => ({
  "index.md": md("Home"),
  "articles/index.md": md("Articles", `layout: listing\nsort: date\n${indexExtra}`),
  "articles/one.md": md("One", "date: 2026-11-02\nimage: /assets/images/one.jpg\n"),
  "articles/two.md": md("Two", "date: 2026-10-01\n"),
  ...extra,
});

async function assemble(route: string, pages: Record<string, string>, skin: Record<string, string> = SKIN) {
  const root = await mkdtemp(join(tmpdir(), "pd-views-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(skin)) await save(join(root, "patterns", ...rel.split("/")), body);
  for (const [rel, body] of Object.entries(pages)) await save(join(root, "pages", ...rel.split("/")), body);
  const dir = join(root, "patterns");
  const { discoveryMap, handleMap } = await buildDiscoveryMap(dir);
  const render = createRenderer({ patternsDir: dir, discoveryMap, handleMap });
  const heads: string[][] = [];
  const page = await assemblePage(route, await readPages(join(root, "pages")), {
    discoveryMap, handleMap, composition: await buildCompositionRegistry(dir, handleMap, discoveryMap),
    site: undefined, workbenchUrl: "https://wb.example/", shown: p => p,
    head: async (_layout, _html, placed) => { heads.push([...placed]); return ""; },
    image: async () => ({ ok: false, message: "no images here" }), render,
  } as PageAssembly);
  return { ...page, placed: heads.at(-1) ?? [] };
}

describe("listing views", () => {
  it("renders the listing through the view its index.md names, in the folder's order, and loads the view's files", async () => {
    const p = await assemble("/articles/", pagesWith("view: list\n"));
    expect(p.problems).toEqual([]);
    expect(p.html).toContain(`<main><h1>Articles</h1><ul class="view-list"><li><a href="/articles/one/">One</a></li><li><a href="/articles/two/">Two</a></li></ul></main>`);
    expect(p.placed).toContain("views/list");
  });

  it("checks every page against the view's card: a grid card that requires an image reports the pages without one", async () => {
    const p = await assemble("/articles/", pagesWith("view: grid\n"));
    expect(p.problems).toEqual([
      `articles/index.md: articles/two.md has no image, which the card of view "grid" (components/grid-card) requires: give it one (image: /assets/images/<name>.jpg, a raster image in the assets)`,
    ]);
  });

  it("fails a view that doesn't exist, naming the skin's views", async () => {
    const p = await assemble("/articles/", pagesWith("view: gird\n"));
    expect(p.problems).toEqual([`articles/index.md:5: view "gird" is not a view: did you mean "grid"? (the views are "grid", "list")`]);
  });

  it("fails a listing whose layout shows a view, when its index.md names none", async () => {
    const p = await assemble("/articles/", pagesWith(""));
    expect(p.problems).toEqual([`articles/index.md: layout "listing" shows a listing (page.listing), so name its view: view: <name> (the views are "grid", "list")`]);
  });

  it("says so when the skin has no views at all", async () => {
    const skin = Object.fromEntries(Object.entries(SKIN).filter(([k]) => !k.startsWith("views/")));
    const p = await assemble("/articles/", pagesWith("view: list\n"), skin);
    expect(p.problems).toEqual([`articles/index.md:5: view "list" is not a view: the skin has no views (components in a views/ folder of its patterns)`]);
  });

  it("fails a view on a page whose layout shows no listing, and on a page that is not a folder's index.md", async () => {
    const onIndex = await assemble("/articles/", { ...pagesWith(""), "articles/index.md": md("Articles", "view: list\n") });
    expect(onIndex.problems).toEqual([`articles/index.md:3: view names how a listing is shown, but layout "page" shows none (it doesn't declare page.listing)`]);
    const onPage = await assemble("/articles/one/", pagesWith("view: list\n", { "articles/one.md": md("One", "view: list\n") }));
    expect(onPage.problems).toEqual([`articles/one.md:3: view names how a folder's pages are listed, so it belongs on the folder's index.md, not on a page`]);
  });

  it("fails a view that names no card for its entries", async () => {
    const p = await assemble("/articles/", pagesWith("view: list\n"), { ...SKIN, "views/list/list.schema.json": json({ properties: { entries: { type: "array" } } }) });
    expect(p.problems).toEqual([`views/list: its schema declares no "entries" list with "x-pd-card": a view names the card it shows each page as, so each page can be checked against it`]);
  });

  it("keeps a view's and its card's sample data to the fields of a listing's page", async () => {
    const p = await assemble("/articles/", pagesWith("view: list\n"), {
      ...SKIN,
      "views/list/list.json": json({ entries: [{ route: "/a/", title: "A", author: "x" }], heading: "Latest" }),
      "components/list-card/list-card.json": json({ title: "Sample", rating: 5 }),
    });
    expect(p.problems).toEqual([
      `the sample data of views/list (list.json) sets "heading", which a view doesn't get: a view gets only entries, the pages of its listing`,
      `the sample data of views/list (list.json) sets "entries[0].author", which is not a field of a page in a listing, so it would show on every page using views/list`,
      `the sample data of components/list-card (list-card.json) sets "rating", which is not a field of a page in a listing, so it would show on every card of views/list`,
    ]);
  });
});
