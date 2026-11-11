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
import { assemblePage, seoTags, SHALLOW_SEO_NOTE, type PageAssembly } from "../src/storefront/page.js";
import { jsonLdScript } from "../src/storefront/json-ld.js";
import type { DatedPage, GitDates } from "../src/storefront/git-dates.js";
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

const ldOf = (script: string) => {
  const m = /^<script type="application\/ld\+json">(.*)<\/script>$/s.exec(script);
  if (!m) throw new Error(`not a JSON-LD script: ${script}`);
  return JSON.parse(m[1]!) as { "@context": string; "@graph": Record<string, unknown>[] };
};
const ld = { siteUrl: URL_, siteTitle: "Bench", route: "/guides/setup/", title: "Setup", description: "How.",
  breadcrumbs: [{ route: "/", title: "Bench" }, { route: "/guides/", title: "Guides" }], modified: "2026-02-10T10:00:00+01:00" };

describe("jsonLdScript", () => {
  it("a page in a folder: the site, the page with its last change, and the trail from Home to the page", () => {
    expect(ldOf(jsonLdScript(ld))).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", "@id": "https://example.test/#website", url: "https://example.test/", name: "Bench" },
        {
          "@type": "WebPage", "@id": "https://example.test/guides/setup/", url: "https://example.test/guides/setup/", name: "Setup",
          description: "How.", isPartOf: { "@id": "https://example.test/#website" }, dateModified: "2026-02-10T10:00:00+01:00",
          breadcrumb: { "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: "Bench", item: "https://example.test/" },
            { "@type": "ListItem", position: 2, name: "Guides", item: "https://example.test/guides/" },
            { "@type": "ListItem", position: 3, name: "Setup", item: "https://example.test/guides/setup/" },
          ] },
        },
      ],
    });
  });

  it("the home page has no trail; a page without description, date or site title leaves them out", () => {
    const [site, page] = ldOf(jsonLdScript({ ...ld, route: "/", breadcrumbs: [], description: undefined, modified: null, siteTitle: undefined }))["@graph"];
    expect(site).toEqual({ "@type": "WebSite", "@id": "https://example.test/#website", url: "https://example.test/" });
    expect(page).toEqual({ "@type": "WebPage", "@id": "https://example.test/", url: "https://example.test/", name: "Setup",
      isPartOf: { "@id": "https://example.test/#website" } });
  });

  it("no value can end the element or open a comment: every < is \\u003c, and the values come back unchanged", () => {
    const title = `A </script><script>alert(1)</script> <!-- title`;
    const script = jsonLdScript({ ...ld, title, description: "x</SCRIPT>y" });
    expect(script.indexOf("<", 1)).toBe(script.lastIndexOf("</script>"));
    const page = ldOf(script)["@graph"][1]!;
    expect([page.name, page.description]).toEqual([title, "x</SCRIPT>y"]);
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

  it("with the site's address: canonical, Open Graph with the page's image, after the description, then the skin's head partial, then the stylesheets", async () => {
    const page = await assemblePage("/", await readPages(await pages()), assembly({ siteUrl: URL_ }));
    expect(page.problems).toEqual([]);
    const head = headOf(page.html);
    expect(head).toContain(`<meta name="description" content="The start.">\n<link rel="canonical" href="https://example.test/">`);
    expect(head).toContain(`<meta property="og:image" content="https://example.test/assets/share.png">`);
    expect(head).toMatch(/<meta name="twitter:card" content="summary_large_image">\n<script type="application\/ld\+json">[^\n]*<\/script>\n<link rel="icon" href="\/assets\/images\/favicon.png">\n<meta name="theme-color" content="#1e3c78">\n<link rel="stylesheet" href="\/_pd\/x.css">/);
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

  const dated = (over: Partial<DatedPage> = {}) => {
    const calls: string[] = [];
    const dates: GitDates = {
      of: async (path: string) => { calls.push(path); return { dates: { created: "2026-01-10T10:00:00+01:00", modified: "2026-02-10T10:00:00+01:00" }, notes: [], problems: [], shallow: false, ...over }; },
      statusChanged: () => {},
    };
    return { dates, calls };
  };
  const graphOf = (html: string) => ldOf(/<script type="application\/ld\+json">.*?<\/script>/s.exec(html)![0])["@graph"];

  it("JSON-LD only with the site's address; its date from git", async () => {
    const dir = await pages();
    const { dates, calls } = dated();
    const page = await assemblePage("/", await readPages(dir), assembly({ siteUrl: URL_, dates }));
    expect(graphOf(page.html)[1]).toMatchObject({ "@type": "WebPage", dateModified: "2026-02-10T10:00:00+01:00" });
    expect(calls).toEqual(["index.md"]);
    expect((await assemblePage("/", await readPages(dir), assembly())).html).not.toContain("application/ld+json");
  });

  it("no git pass for a site without an address whose layout shows no dates", async () => {
    const { dates, calls } = dated();
    await assemblePage("/", await readPages(await pages()), assembly({ dates }));
    expect(calls).toEqual([]);
  });

  it("a shallow clone: no dateModified, no problem, one note whatever the page; other date notes are not the JSON-LD's", async () => {
    const dir = await pages();
    const shallow = dated({ shallow: true, notes: ["index.md: a date note"], problems: ["index.md: the repository is a shallow clone"] });
    const home = await assemblePage("/", await readPages(dir), assembly({ siteUrl: URL_, dates: shallow.dates }));
    expect(home.problems).toEqual([]);
    expect(home.notes).toEqual([SHALLOW_SEO_NOTE]);
    expect(graphOf(home.html)[1]).not.toHaveProperty("dateModified");
    const draft = await assemblePage("/draft/", await readPages(dir), assembly({ siteUrl: URL_, dates: shallow.dates }));
    expect(draft.notes).toEqual([SHALLOW_SEO_NOTE]);
  });

  it("the site's language on <html>, en unless set", async () => {
    const dir = await pages();
    expect((await assemblePage("/", await readPages(dir), assembly())).html).toContain(`<html lang="en">`);
    expect((await assemblePage("/", await readPages(dir), assembly({ lang: "de-AT" }))).html).toContain(`<html lang="de-AT">`);
  });
});
