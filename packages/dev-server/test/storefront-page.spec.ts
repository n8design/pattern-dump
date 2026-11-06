// A storefront page, assembled from the bench's own skin with the real renderer: what reaches the page,
// what never does (the layouts' sample data), and every way a page fails, each fatal and listed escaped.
// The <head>'s stylesheet links are the caller's (stubbed here; served pages are checked over HTTP).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { createHeightFitter, type DiscoveryMap, type Render } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry, type CompositionRegistry } from "../src/composition.js";
import { frontmatterBody } from "../src/frontmatter.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";

const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
const patterns = join(bench, "src", "patterns");
const SITE = { title: "Storefront bench", tagline: "A website written in markdown", href: "/", footer: "Built with Pattern Dump from the storefront bench." };
const WB = "https://workbench.example.test/";

let tmp = "";
let map: DiscoveryMap;
let composition: CompositionRegistry;
let render: Render;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-page-"));
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  map = discoveryMap;
  composition = await buildCompositionRegistry(patterns, handleMap, discoveryMap);
  render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const assembly = (over: Partial<PageAssembly> = {}): PageAssembly => ({
  discoveryMap: map, composition, render, site: SITE, workbenchUrl: WB,
  head: async (layoutId) => `<link rel="stylesheet" href="/_pd/head-for/${layoutId}">`,
  ...over,
});

let n = 0;
/** A pages folder from { "path": "contents" }, beside the bench's own skin. */
async function pagesOf(files: Record<string, string>): Promise<string> {
  const dir = join(tmp, `pages-${n++}`);
  for (const [path, body] of Object.entries(files)) {
    const file = join(dir, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  return dir;
}
const build = async (route: string, dir: string, over: Partial<PageAssembly> = {}) => assemblePage(route, await readPages(dir), assembly(over));

describe("assemblePage — the bench's pages", () => {
  it("renders the home page through its layout, with the storefront's nav, site and examples", async () => {
    const page = await build("/", join(bench, "pages"));
    expect(page.problems).toEqual([]);
    expect(page.status).toBe(200);
    const html = page.html;
    expect(html).toContain("<title>Storefront bench</title>");
    expect(html).toContain(`<meta name="description" content="A small website rendered from markdown, with the bench's own skin.">`);
    expect(html).toContain(`<link rel="stylesheet" href="/_pd/head-for/layouts/home">`);
    expect(html).toContain(`<h1 class="home-title">Storefront bench</h1>`);
    expect(html).toContain(`<a href="/" aria-current="page">Storefront bench</a>`);
    expect(html).toContain(`<a href="/guides/">Guides</a>`);
    expect(html).toContain(`<iframe src="/preview/components/callout" title="components/callout" loading="lazy"></iframe>`);
    expect(html).toContain(`<a href="https://workbench.example.test/components/callout">Open components/callout in the workbench</a>`);
    expect(html).toContain("<p>Built with Pattern Dump from the storefront bench.</p>");
    // A card for every other part of the site, none for the home page itself; a folder's card lists its pages.
    const cards = parse(html).querySelectorAll(`nav.site-cards[aria-label="Sections"] .card`);
    expect(cards.map(c => c.querySelector(".card-title")?.getAttribute("href"))).toEqual(["/guides/", "/about/"]);
    expect(cards[0].querySelectorAll(".card-pages a").map(a => [a.getAttribute("href"), a.text])).toEqual([["/guides/setup/", "Setup"]]);
    // The layout's sample body never shows.
    expect(html).not.toContain("This is the body of a page");
    expect(html).not.toContain("data-pd-live");
  });

  it("shows a folder's pages as cards on the folder's own page, and no cards on a page without pages", async () => {
    const guides = parse((await build("/guides/", join(bench, "pages"))).html);
    expect(guides.querySelectorAll(`nav.site-cards[aria-label="In this section"] .card-title`).map(a => [a.getAttribute("href"), a.text]))
      .toEqual([["/guides/setup/", "Setup"]]);
    for (const route of ["/about/", "/guides/setup/"]) {
      expect(parse((await build(route, join(bench, "pages"))).html).querySelectorAll(".site-cards"), route).toHaveLength(0);
    }
  });

  it("renders an article with its lede, and marks it current in the nav", async () => {
    const page = await build("/guides/setup/", join(bench, "pages"));
    expect(page.status).toBe(200);
    expect(page.html).toContain(`<title>Setup — Storefront bench</title>`);
    expect(page.html).toContain(`<p class="article-lede">Three folders make a site — the pages, the layouts that dress them, and the components they show.</p>`);
    expect(page.html).toContain(`<a href="/guides/setup/" aria-current="page">Setup</a>`);
    expect(page.html).not.toContain(`<a href="/" aria-current="page">`);
  });

  it("inlines the one height fitter, from contracts", async () => {
    const page = await build("/", join(bench, "pages"));
    expect(page.html).toContain(`var createHeightFitter=(${createHeightFitter.toString()});`);
  });
});

describe("assemblePage — the layouts' sample data never reaches a page", () => {
  it("passes a declared key the page does not set as null, so the sample's value does not show", async () => {
    // layouts/page's sample data has a description; this page sets none.
    const sample = JSON.parse(await readFile(join(patterns, "layouts", "page", "page.json"), "utf8")) as { description: string };
    expect(sample.description).toBe("A small website rendered from markdown, with the bench's own skin.");
    const page = await build("/", await pagesOf({ "index.md": "---\ntitle: Plain\n---\nBody.\n" }));
    expect(page.status).toBe(200);
    expect(page.html).not.toContain(sample.description);
    expect(page.html).not.toContain(`class="page-description"`);
  });

  it("passes a site key the config does not set as null, so the sample's value does not show", async () => {
    const { tagline: _t, ...noTagline } = SITE;
    const page = await build("/", join(bench, "pages"), { site: noTagline });
    expect(page.status).toBe(200);
    expect(page.html).not.toContain("A website written in markdown");
  });

  it("takes the nav from the pages, not from the sample", async () => {
    const page = await build("/", await pagesOf({ "index.md": "---\ntitle: Alpha\n---\n", "beta.md": "---\ntitle: Beta\n---\n" }));
    expect(page.html).toContain(`<a href="/beta/">Beta</a>`);
    expect(page.html).not.toContain("Guides");
  });
});

describe("assemblePage — in pd dev", () => {
  it("adds the live-reload client, on the given port, to pages and to error pages", async () => {
    const ok = await build("/", join(bench, "pages"), { live: { wsPort: 4301 } });
    expect(ok.html).toContain(`<script data-pd-live>`);
    expect(ok.html).toContain(`location.hostname+":4301"`);
    const bad = await build("/", await pagesOf({ "index.md": "---\ntitle: T\nbogus: 1\n---\n" }), { live: { wsPort: 4301 } });
    expect(bad.status).toBe(500);
    expect(bad.html).toContain(`<script data-pd-live>`);
  });
});

describe("assemblePage — every problem is fatal, and listed escaped", () => {
  it("lists every problem of a page instead of rendering it", async () => {
    const md = "---\ntitle: T\nlayout: <img src=x onerror=alert(1)>\n---\n";
    const page = await build("/", await pagesOf({ "index.md": md }));
    expect(page.status).toBe(500);
    expect(page.problems).toEqual([`index.md:3: layout "<img src=x onerror=alert(1)>" is not a layout — the layouts are "article", "home", "page"`]);
    expect(page.html).not.toContain("<img src=x");
    expect(page.html).toContain(`<li>index.md:3: layout &quot;&lt;img src=x onerror=alert(1)&gt;&quot; is not a layout`.replace(/&quot;/g, `"`));
  });

  it("lists frontmatter, site and example problems together", async () => {
    const md = "---\ntitle: T\nbogus: 1\n---\n\n```pattern components/nope\n```\n\n[gone](pattern:components/gone)\n";
    const page = await build("/", await pagesOf({ "index.md": md }), { site: { tagline: "No title" } });
    expect(page.status).toBe(500);
    expect(page.problems).toEqual([
      `index.md:3: "bogus" is not declared by layout "page"`,
      "storefront.site.title is required by partials/base",
      "index.md: pattern:components/gone: there is no such component",
      "index.md: pattern components/nope: there is no such component",
    ]);
    for (const p of page.problems) expect(page.html).toContain(`<li>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`);
  });

  it("makes an unknown pattern id in a page fatal", async () => {
    const page = await build("/", await pagesOf({ "index.md": "---\ntitle: T\n---\n\n```pattern components/nope\n```\n" }));
    expect(page.status).toBe(500);
    expect(page.problems).toEqual(["index.md: pattern components/nope: there is no such component"]);
  });

  it("makes a problem of the pages folder fatal for every page", async () => {
    const dir = await pagesOf({ "index.md": "---\ntitle: Home\n---\n", "about.md": "---\ntitle: About\n---\n", "Bad Name.md": "x" });
    for (const route of ["/", "/about/"]) {
      const page = await build(route, dir);
      expect(page.status, route).toBe(500);
      expect(page.problems, route).toEqual(["Bad Name.md: a page's file name is part of the URL, so it is lowercase letters, digits and hyphens only, then .md"]);
    }
  });

  it("answers a route with no page with 404", async () => {
    const page = await build("/nope/", join(bench, "pages"));
    expect(page.status).toBe(404);
    expect(page.problems).toEqual(["there is no page at /nope/"]);
  });
});

describe("the skin's templates", () => {
  it("use {{{body}}} as their only unescaped value", async () => {
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith(".hbs")) for (const m of (await readFile(p, "utf8")).matchAll(/\{\{\{[^}]*\}\}\}/g)) found.push(`${p.slice(patterns.length + 1)}: ${m[0]}`);
      }
    };
    await walk(join(patterns, "layouts"));
    await walk(join(patterns, "partials"));
    expect(found).toEqual(["layouts/article/article.hbs: {{{body}}}", "layouts/home/home.hbs: {{{body}}}", "layouts/page/page.hbs: {{{body}}}"]);
  });
});

describe("frontmatterBody", () => {
  it("is the markdown after the block, found as the readings find it", () => {
    expect(frontmatterBody("---\ntitle: A\n---\n# Body\n")).toBe("# Body\n");
    expect(frontmatterBody("﻿---\r\ntitle: A\r\n---\r\n# Body\r\n")).toBe("# Body\n");
    expect(frontmatterBody("# No block\n")).toBe("# No block\n");
    expect(frontmatterBody("﻿# No block")).toBe("# No block");
    expect(frontmatterBody("---\ntitle: never closed\n# Body\n")).toBe("");
  });
});

