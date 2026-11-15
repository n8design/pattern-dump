// A listing's card (x-pd-card on a layout's page.children): every page in the listing is checked against the
// card's schema. A field the card requires that a page doesn't have fails the listing page, naming that page and
// what to add; a card may declare only the fields of a listing's entry (Pattern Dump's shape, the base every card
// shares); its sample data is checked against that shape, not against the layout's keys.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderInput } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

const md = (title: string, extra = "", body = `Body of ${title}.`): string => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;

/** The listing layout: one card per page.children entry, the card named by x-pd-card. */
const LISTING = {
  "layouts/listing/listing.hbs": `<main><h1>{{title}}</h1>{{{body}}}<ul>{{#each page.children}}<li>{{> components-card }}</li>{{/each}}</ul></main>`,
  "layouts/listing/listing.schema.json": JSON.stringify({
    properties: { title: { type: "string" }, page: { type: "object", properties: { children: { "x-pd-card": "components/card" } } } },
  }),
  "layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>`,
  "layouts/page/page.schema.json": JSON.stringify({ properties: { title: { type: "string" } } }),
  "components/card/card.hbs": `<article><h2><a href="{{route}}">{{title}}</a></h2>{{#if date}}<time datetime="{{date}}">{{date}}</time>{{/if}}</article>`,
};
const card = (schema: unknown) => ({ "components/card/card.schema.json": JSON.stringify(schema) });
const SITE = {
  "index.md": md("Home"),
  "articles/index.md": md("Articles", "layout: listing\nsort: date\n"),
  "articles/one.md": md("One", "date: 2026-11-02\nimage: /assets/images/one.jpg\ntags: [css]\n"),
  "articles/two.md": md("Two", "date: 2026-10-01\n"),
};

async function assemble(route: string, patterns: Record<string, string>, pages: Record<string, string> = SITE) {
  const root = await mkdtemp(join(tmpdir(), "pd-cards-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(patterns)) await save(join(root, "patterns", ...rel.split("/")), body);
  for (const [rel, body] of Object.entries(pages)) await save(join(root, "pages", ...rel.split("/")), body);
  const dir = join(root, "patterns");
  const { discoveryMap, handleMap } = await buildDiscoveryMap(dir);
  const render = createRenderer({ patternsDir: dir, discoveryMap, handleMap });
  const inputs: RenderInput[] = [];
  const page = await assemblePage(route, await readPages(join(root, "pages")), {
    discoveryMap, handleMap, composition: await buildCompositionRegistry(dir, handleMap, discoveryMap),
    site: undefined, workbenchUrl: "https://wb.example/", shown: p => p, head: async () => "",
    image: async () => ({ ok: false, message: "no images here" }),
    render: input => { inputs.push(input); return render(input); },
  } as PageAssembly);
  return page;
}

const ENTRY_FIELDS = "route, title, description, date, updated, image, tags, categories, draft, scheduled";

describe("x-pd-card: each page of a listing, checked against its card", () => {
  it("renders a listing whose pages have every field the card requires", async () => {
    const p = await assemble("/articles/", { ...LISTING, ...card({ required: ["route", "title", "date"], properties: { route: { type: "string" }, title: { type: "string" }, date: { type: ["string", "null"] } } }) });
    expect(p.problems).toEqual([]);
    expect(p.html).toContain(`<li><article><h2><a href="/articles/one/">One</a></h2><time datetime="2026-11-02">2026-11-02</time></article></li>`);
  });

  it("reports each page without a field the card requires, naming the page and what to add", async () => {
    const p = await assemble("/articles/", { ...LISTING, ...card({ required: ["title", "image", "tags"], properties: { title: { type: "string" }, image: { type: ["string", "null"] }, tags: { type: "array" } } }) });
    expect(p.status).toBe(500);
    expect(p.problems).toEqual([
      `articles/index.md: articles/two.md has no image, which the listing's card (components/card) requires: give it one (image: /assets/images/<name>.jpg, a raster image in the assets)`,
      // An empty list is no tags at all.
      `articles/index.md: articles/two.md has no tags, which the listing's card (components/card) requires: give it one (tags: [a-tag])`,
    ]);
  });

  it("checks a page's value against the type the card declares", async () => {
    const p = await assemble("/articles/", { ...LISTING, ...card({ properties: { title: { type: "string" }, tags: { type: "string" } } }) });
    expect(p.problems).toEqual([`articles/index.md: articles/one.md: tags must be text (got ["css"]) for the listing's card (components/card)`]);
  });

  it("refuses a card that declares a field a listing's page doesn't have, once", async () => {
    const p = await assemble("/articles/", { ...LISTING, ...card({ required: ["author"], properties: { title: { type: "string" }, author: { type: "string" } } }) });
    expect(p.problems).toEqual([
      `components/card (the listing's card, layouts/listing) declares "author", which a page in a listing doesn't have: a card declares only the fields Pattern Dump fills (${ENTRY_FIELDS})`,
    ]);
  });

  it("checks a card's sample data against a listing's page, not against the layout's keys", async () => {
    const schema = card({ properties: { route: { type: "string" }, title: { type: "string" } } });
    // Keys of an entry: fine, though the layout declares none of them.
    expect((await assemble("/articles/", { ...LISTING, ...schema, "components/card/card.json": JSON.stringify({ route: "/x/", title: "Sample", tags: ["a"] }) })).problems).toEqual([]);
    // A key outside the entry would show on every card of every listing.
    expect((await assemble("/articles/", { ...LISTING, ...schema, "components/card/card.json": JSON.stringify({ title: "Sample", author: "Someone" }) })).problems).toEqual([
      `the sample data of components/card (card.json) sets "author", which is not a field of a page in a listing, so it would show on every card of layouts/listing`,
    ]);
  });

  it("fails the listing when the card named is not a component with a schema", async () => {
    const p = await assemble("/articles/", { ...LISTING, "layouts/listing/listing.schema.json": JSON.stringify({
      properties: { title: { type: "string" }, page: { type: "object", properties: { children: { "x-pd-card": "components/nope" } } } },
    }) });
    expect(p.problems).toEqual([`layouts/listing: x-pd-card names "components/nope", which is not a component`]);
  });

  it("leaves a listing whose layout names no card unchecked, as before", async () => {
    const p = await assemble("/articles/", { ...LISTING, ...card({ required: ["image"], properties: { image: { type: "string" } } }), "layouts/listing/listing.schema.json": JSON.stringify({
      properties: { title: { type: "string" }, page: { type: "object", properties: { children: {} } } },
    }) });
    expect(p.problems).toEqual([]);
  });
});
