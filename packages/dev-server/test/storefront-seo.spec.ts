// A storefront page's search and link-preview tags (page.ts seoTags), and what reaches the page's <head>
// and <html>: canonical and Open Graph only with the site's address, noindex from the page or the site,
// the site's language. Assembled with the bench's own skin and the real renderer.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveryMap, Render } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry, type CompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, seoTags, type PageAssembly } from "../src/storefront/page.js";
import { checkPageImage } from "../src/storefront/page-image.js";
import { save } from "../../../test-support/save.js";

const URL_ = "https://example.test/";
const IMAGE = { path: "/assets/share.png", format: "png" as const, width: 1200, height: 630 };
const base = { route: "/guides/setup/", title: "Setup", description: "How it is built.", siteTitle: "Bench", siteUrl: URL_, image: undefined, index: true };

describe("seoTags", () => {
  it("writes canonical, Open Graph and a summary card from the site's address and the route", () => {
    expect(seoTags(base)).toEqual([
      `<link rel="canonical" href="https://example.test/guides/setup/">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="Bench">`,
      `<meta property="og:title" content="Setup">`,
      `<meta property="og:description" content="How it is built.">`,
      `<meta property="og:url" content="https://example.test/guides/setup/">`,
      `<meta name="twitter:card" content="summary">`,
    ]);
  });

  it("gives the home page the site's address itself", () => {
    expect(seoTags({ ...base, route: "/" })[0]).toBe(`<link rel="canonical" href="https://example.test/">`);
  });

  it("adds the image with its size, as an absolute URL, and a large card", () => {
    const tags = seoTags({ ...base, image: IMAGE });
    expect(tags).toContain(`<meta property="og:image" content="https://example.test/assets/share.png">`);
    expect(tags).toContain(`<meta property="og:image:width" content="1200">`);
    expect(tags).toContain(`<meta property="og:image:height" content="630">`);
    expect(tags.at(-1)).toBe(`<meta name="twitter:card" content="summary_large_image">`);
  });

  it("leaves out what the page doesn't have: description, site title", () => {
    const tags = seoTags({ ...base, description: undefined, siteTitle: undefined });
    expect(tags.some(t => t.includes("og:description") || t.includes("og:site_name"))).toBe(false);
  });

  it("without the site's address, writes nothing that needs one, only robots", () => {
    expect(seoTags({ ...base, siteUrl: undefined, image: IMAGE })).toEqual([]);
    expect(seoTags({ ...base, siteUrl: undefined, index: false })).toEqual([`<meta name="robots" content="noindex">`]);
  });

  it("puts noindex first when the page is kept out of search engines", () => {
    expect(seoTags({ ...base, index: false })[0]).toBe(`<meta name="robots" content="noindex">`);
  });

  it("escapes every value it writes into an attribute", () => {
    const tags = seoTags({ ...base, title: `A "quoted" <title> & more`, description: `<script>x</script>`, siteTitle: `"Bench"` });
    expect(tags).toContain(`<meta property="og:title" content="A &quot;quoted&quot; &lt;title&gt; &amp; more">`);
    expect(tags).toContain(`<meta property="og:description" content="&lt;script&gt;x&lt;/script&gt;">`);
    expect(tags).toContain(`<meta property="og:site_name" content="&quot;Bench&quot;">`);
  });
});

const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
const patterns = join(bench, "src", "patterns");
let tmp = "";
let map: DiscoveryMap;
let composition: CompositionRegistry;
let render: Render;
let assets = "";

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-seo-"));
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  map = discoveryMap;
  composition = await buildCompositionRegistry(patterns, handleMap, discoveryMap);
  render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
  assets = join(tmp, "assets");
  await mkdir(assets, { recursive: true });
  await save(join(assets, "share.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb0, 0, 0, 2, 0x76, 8, 6, 0, 0, 0]));
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const assembly = (over: Partial<PageAssembly> = {}): PageAssembly => ({
  discoveryMap: map, composition, render, site: { title: "Bench" }, workbenchUrl: "https://workbench.example.test/",
  head: async () => `<link rel="stylesheet" href="/_pd/x.css">`,
  image: path => checkPageImage(path, [assets], ["assets"]),
  ...over,
});
let n = 0;
async function pagesOf(files: Record<string, string>): Promise<string> {
  const dir = join(tmp, `pages-${n++}`);
  for (const [path, body] of Object.entries(files)) {
    const file = join(dir, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await save(file, body);
  }
  return dir;
}
const headOf = (html: string) => html.slice(html.indexOf("<head>"), html.indexOf("</head>"));

describe("assemblePage — the head", () => {
  const pages = () => pagesOf({
    "index.md": "---\ntitle: Home\ndescription: The start.\nimage: /assets/share.png\n---\n\nHi.\n",
    "draft.md": "---\ntitle: Draft\nindex: false\n---\n\nNot yet.\n",
  });

  it("with the site's address: canonical, Open Graph with the page's image, after the description, before the stylesheets", async () => {
    const page = await assemblePage("/", await readPages(await pages()), assembly({ siteUrl: URL_ }));
    expect(page.problems).toEqual([]);
    const head = headOf(page.html);
    expect(head).toContain(`<meta name="description" content="The start.">\n<link rel="canonical" href="https://example.test/">`);
    expect(head).toContain(`<meta property="og:image" content="https://example.test/assets/share.png">`);
    expect(head).toContain(`<meta name="twitter:card" content="summary_large_image">\n<link rel="stylesheet" href="/_pd/x.css">`);
  });

  it("without it: none of the tags that need it", async () => {
    const page = await assemblePage("/", await readPages(await pages()), assembly());
    expect(headOf(page.html)).not.toMatch(/canonical|og:|twitter:/);
  });

  it("noindex for a page with index: false, and for every page of a site with index: false", async () => {
    const dir = await pages();
    const draft = await assemblePage("/draft/", await readPages(dir), assembly({ siteUrl: URL_ }));
    expect(headOf(draft.html)).toContain(`<meta name="robots" content="noindex">`);
    const home = await assemblePage("/", await readPages(dir), assembly({ siteUrl: URL_ }));
    expect(headOf(home.html)).not.toContain("noindex");
    const staging = await assemblePage("/", await readPages(dir), assembly({ siteUrl: URL_, siteIndex: false }));
    expect(headOf(staging.html)).toContain(`<meta name="robots" content="noindex">`);
  });

  it("the site's language on <html>, en unless set", async () => {
    const dir = await pages();
    expect((await assemblePage("/", await readPages(dir), assembly())).html).toContain(`<html lang="en">`);
    expect((await assemblePage("/", await readPages(dir), assembly({ lang: "de-AT" }))).html).toContain(`<html lang="de-AT">`);
  });
});
