// A storefront page, assembled from the bench's own skin with the real renderer: what reaches the page,
// what never does (the layouts' sample data), and every way a page fails, each fatal and listed escaped.
// The <head>'s stylesheet links are the caller's (stubbed here; served pages are checked over HTTP).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHeightFitter, type DiscoveryMap, type Render } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry, type CompositionRegistry } from "../src/composition.js";
import { frontmatterBody } from "../src/frontmatter.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { checkPageImage } from "../src/storefront/page-image.js";
import { save } from "../../../test-support/save.js";

const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
const patterns = join(bench, "src", "patterns");
const SITE = { title: "Storefront bench", tagline: "A website written in markdown", href: "/", footer: "Built with Pattern Dump from the storefront bench." };
const WB = "https://workbench.example.test/";

let tmp = "";
let map: DiscoveryMap;
let composition: CompositionRegistry;
let render: Render;
let assets = "";

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-page-"));
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  map = discoveryMap;
  composition = await buildCompositionRegistry(patterns, handleMap, discoveryMap);
  render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
  assets = join(tmp, "assets");
  await mkdir(assets, { recursive: true });
  // A PNG header is all the check reads: 1200 × 630.
  await save(join(assets, "share.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb0, 0, 0, 2, 0x76, 8, 6, 0, 0, 0]));
  await save(join(assets, "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg"/>`);
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const assembly = (over: Partial<PageAssembly> = {}): PageAssembly => ({
  discoveryMap: map, composition, render, site: SITE, workbenchUrl: WB,
  head: async (layoutId) => `<link rel="stylesheet" href="/_pd/head-for/${layoutId}">`,
  image: path => checkPageImage(path, [assets], ["assets"]),
  ...over,
});

let n = 0;
/** A pages folder from { "path": "contents" }, beside the bench's own skin. */
async function pagesOf(files: Record<string, string>): Promise<string> {
  const dir = join(tmp, `pages-${n++}`);
  for (const [path, body] of Object.entries(files)) {
    const file = join(dir, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await save(file, body);
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
    expect(html).toContain(`<h1 class="page-title">Storefront bench</h1>`);
    expect(html).toContain(`<a href="/" aria-current="page">Storefront bench</a>`);
    expect(html).toContain(`<a href="/guides/">Guides</a>`);
    expect(html).toContain(`<iframe src="/preview/components/callout" title="components/callout" loading="lazy"></iframe>`);
    expect(html).toContain(`<a href="https://workbench.example.test/components/callout">Open components/callout in the workbench</a>`);
    expect(html).toContain("<p>Built with Pattern Dump from the storefront bench.</p>");
    // The layout's sample body never shows.
    expect(html).not.toContain("This is the body of a page");
    expect(html).not.toContain("data-pd-live");
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
    expect(page.problems).toEqual([`index.md:3: layout "<img src=x onerror=alert(1)>" is not a layout — the layouts are "article", "doc", "home", "page"`]);
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
    // The site's problem is marked as the whole site's (a build lists it once); the page's own are not.
    const siteWide = new Set(["storefront.site.title is required by partials/base"]);
    for (const p of page.problems) {
      expect(page.html).toContain(`<li${siteWide.has(p) ? " data-pd-site" : ""}>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`);
    }
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

describe("assemblePage — the link-preview image", () => {
  const page = (image?: string) => `---\ntitle: About\n${image ? `image: ${image}\n` : ""}---\n\nText.\n`;

  it("renders a page whose image is a raster file in the assets", async () => {
    const dir = await pagesOf({ "index.md": page("/assets/share.png") });
    expect((await build("/", dir)).problems).toEqual([]);
  });

  it("fails a page whose own image is an SVG, at the image's line", async () => {
    const dir = await pagesOf({ "index.md": page("/assets/logo.svg") });
    const r = await build("/", dir);
    expect(r.status).toBe(500);
    expect(r.problems).toEqual([`index.md:3: image "/assets/logo.svg" is an SVG; link previews need a raster image (PNG, JPEG, GIF or WebP)`]);
  });

  it("fails every page on a bad storefront.image, as the whole site's problem, unless the page names its own", async () => {
    const dir = await pagesOf({ "index.md": page(), "about.md": page("/assets/share.png") });
    const home = await build("/", dir, { siteImage: "/assets/missing.png" });
    const message = `storefront.image: image "/assets/missing.png" does not exist in the assets`;
    expect(home.problems).toEqual([message]);
    expect(home.html).toContain(`<li data-pd-site>${message}</li>`);
    expect((await build("/about/", dir, { siteImage: "/assets/missing.png" })).problems).toEqual([]);
  });
});

describe("assemblePage — a layout field named like a helper", () => {
  it("fails the page with the problem the workbench shows on the layout", async () => {
    // A skin of its own: one layout, whose schema declares `id`, which is Pattern Dump's id helper.
    const skin = join(tmp, "helper-skin");
    for (const [rel, text] of Object.entries({
      "layouts/plain/plain.hbs": `<main id="{{id}}">{{title}}{{{body}}}</main>\n`,
      "layouts/plain/plain.schema.json": JSON.stringify({ required: ["title"], properties: { title: { type: "string" }, id: { type: "string" } } }),
    })) {
      await mkdir(dirname(join(skin, rel)), { recursive: true });
      await save(join(skin, rel), text);
    }
    const { discoveryMap, handleMap } = await buildDiscoveryMap(skin);
    const page = await build("/", await pagesOf({ "index.md": "---\nlayout: plain\ntitle: Home\nid: top\n---\n\nText.\n" }), {
      discoveryMap, composition: await buildCompositionRegistry(skin, handleMap, discoveryMap),
      render: createRenderer({ patternsDir: skin, discoveryMap, handleMap }), site: undefined,
    });
    expect(page.status).toBe(500);
    expect(page.problems).toEqual([
      `layouts/plain/plain.schema.json (#/properties/id): "id" is the name of a registered helper, so {{id}} would call the helper, not read this field`,
    ]);
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
    expect(found).toEqual(["layouts/article/article.hbs: {{{body}}}", "layouts/doc/doc.hbs: {{{body}}}", "layouts/home/home.hbs: {{{body}}}", "layouts/page/page.hbs: {{{body}}}"]);
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

