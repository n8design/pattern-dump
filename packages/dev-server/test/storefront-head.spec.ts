// A skin's head partial (head-partial.ts): its markup goes into every page's <head> after what Pattern Dump
// writes and before the stylesheets, rendered with the site's values. It may hold only head elements, and
// none Pattern Dump writes itself; its sample data can't reach a page. Every problem is the whole site's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { checkHeadMarkup } from "../src/storefront/head-partial.js";
import { save } from "../../../test-support/save.js";

describe("checkHeadMarkup", () => {
  it("takes what belongs in a head and isn't Pattern Dump's", () => {
    expect(checkHeadMarkup(`<link rel="icon" href="/i.png">\n<meta name="theme-color" content="#000">\n<!-- a note -->
<link rel="preload" href="/f.woff2" as="font" crossorigin><script src="/x.js" defer></script><style>:root{--x:1}</style>
<noscript><link rel="stylesheet" href="/n.css"></noscript><meta property="article:author" content="x">`)).toEqual([]);
    expect(checkHeadMarkup("")).toEqual([]);
  });

  it("names each element Pattern Dump writes itself", () => {
    const own = (tag: string) => `partials/head: ${tag} is written by Pattern Dump on every page; a head partial must not write it`;
    expect(checkHeadMarkup(`<title>T</title>`)).toEqual([own("<title>")]);
    expect(checkHeadMarkup(`<link rel="canonical" href="/x">`)).toEqual([own(`<link rel="canonical">`)]);
    expect(checkHeadMarkup(`<link href="/x" rel='alternate canonical'>`)).toEqual([own(`<link rel="canonical">`)]);
    expect(checkHeadMarkup(`<meta name="description" content="x">`)).toEqual([own(`<meta name="description">`)]);
    expect(checkHeadMarkup(`<META NAME="Robots" content="noindex">`)).toEqual([own(`<meta name="robots">`)]);
    expect(checkHeadMarkup(`<meta property="og:title" content="x">`)).toEqual([own(`<meta property="og:title">`)]);
    expect(checkHeadMarkup(`<meta name="twitter:card" content="x">`)).toEqual([own(`<meta name="twitter:card">`)]);
    expect(checkHeadMarkup(`<script type="application/ld+json">{}</script>`)).toEqual([own(`<script type="application/ld+json">`)]);
    expect(checkHeadMarkup(`<base href="/x/">`)).toEqual([`partials/head: <base> would change every link on the page; a head partial must not write it`]);
  });

  it("names an element or text that doesn't belong in a head", () => {
    expect(checkHeadMarkup(`<p>Hello</p>`)).toEqual([
      `partials/head: <p> does not belong in <head>: a head partial may hold only <meta>, <link>, <script>, <style> and <noscript>`,
      `partials/head: text ("Hello") does not belong in <head>: a head partial may hold only elements`,
    ]);
    expect(checkHeadMarkup(`<div class="x"></div>`)).toHaveLength(1);
    expect(checkHeadMarkup(`just words`)).toEqual([`partials/head: text ("just words") does not belong in <head>: a head partial may hold only elements`]);
  });
});

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-head-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
/** A project of `files` (patterns and pages), assembled at `route`. */
async function page(files: Record<string, string>, route = "/") {
  const root = join(tmp, `p${n++}`);
  const all: Record<string, string> = {
    "patterns/layouts/page/page.hbs": "<main>{{{body}}}</main>",
    "patterns/layouts/page/page.schema.json": JSON.stringify({ properties: { title: { type: "string" } } }),
    "patterns/partials/base/base.hbs": "<div>{{> @partial-block}}</div>",
    "patterns/partials/base/base.schema.json": SITE_SCHEMA,
    "pages/index.md": "---\ntitle: Home\n---\n\nHi.\n",
    "pages/about.md": "---\ntitle: About\n---\n\nAbout.\n",
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  const patterns = join(root, "patterns");
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const composition = await buildCompositionRegistry(patterns, handleMap, discoveryMap);
  const render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
  const a: PageAssembly = {
    discoveryMap, handleMap, composition, render, shown: p => p, site: { title: "Bench", tagline: "Plain" },
    workbenchUrl: "https://wb.test/", head: async () => `<link rel="stylesheet" href="/_pd/x.css">`,
    image: async () => ({ ok: false, message: "no image here" }),
  };
  return assemblePage(route, await readPages(join(root, "pages")), a);
}
const SITE_SCHEMA = JSON.stringify({ properties: { site: { type: "object", properties: { title: { type: "string" }, tagline: { type: "string" } } } } });
const headOf = (html: string) => html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
describe("assemblePage — the head partial", () => {
  it("goes into every page's head after Pattern Dump's tags and before the stylesheets, with the site's values", async () => {
    const files = { "patterns/partials/head/head.hbs": `<meta name="application-name" content="{{site.title}}">` };
    for (const route of ["/", "/about/"]) {
      const p = await page(files, route);
      expect(p.problems).toEqual([]);
      expect(headOf(p.html)).toMatch(/<\/title>\n<meta name="application-name" content="Bench">\n<link rel="stylesheet" href="\/_pd\/x.css">/);
    }
  });

  it("without one, the head is as before", async () => {
    const p = await page({});
    expect(headOf(p.html)).toMatch(/<\/title>\n<link rel="stylesheet" href="\/_pd\/x.css">\n$/);
  });

  it("fails every page on markup that is not its to write, listed once for the whole site", async () => {
    const p = await page({ "patterns/partials/head/head.hbs": `<title>Mine</title><p>hi</p>` });
    expect(p.status).toBe(500);
    expect(p.problems).toEqual([
      "partials/head: <title> is written by Pattern Dump on every page; a head partial must not write it",
      "partials/head: <p> does not belong in <head>: a head partial may hold only <meta>, <link>, <script>, <style> and <noscript>",
      `partials/head: text ("hi") does not belong in <head>: a head partial may hold only elements`,
    ]);
    expect(p.html).toContain(`<li data-pd-site>partials/head: &lt;title&gt; is written by Pattern Dump`);
  });

  it("fails every page on sample data that would reach a page", async () => {
    const p = await page({
      "patterns/partials/head/head.hbs": `<meta name="x" content="{{color}}">`,
      "patterns/partials/head/head.json": `{ "color": "red" }`,
    });
    expect(p.status).toBe(500);
    expect(p.problems).toEqual([`the sample data of partials/head (head.json) sets "color", which partials/head does not declare, so it would show on every page using that layout`]);
    expect(p.html).toContain("<li data-pd-site>the sample data of partials/head");
  });

  it("fails every page on a head partial that does not render", async () => {
    const p = await page({ "patterns/partials/head/head.hbs": `{{nope-helper "x"}}` });
    expect(p.status).toBe(500);
    expect(p.problems).toHaveLength(1);
    expect(p.problems[0]).toMatch(/^partials\/head: /);
  });
});
