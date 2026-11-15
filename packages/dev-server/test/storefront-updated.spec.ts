// A page's authored `updated: YYYY-MM-DD`, set for real content changes. It is the only "last changed" date a
// reader or a search engine sees: page.updated, JSON-LD dateModified, article:modified_time and the sitemap's
// lastmod. Git's last commit (which a typo fix or a reformat moves) is used for none of them, and a layout that still
// declares page.modified is told what to declare instead.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderInput } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { readPages } from "../src/storefront/pages.js";
import { buildCompositionRegistry } from "../src/composition.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { sitemapEntries } from "../src/storefront/site-files.js";
import type { GitDates } from "../src/storefront/git-dates.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

const page = (title: string, extra = ""): string => `---\ntitle: ${title}\n${extra}---\n\nBody of ${title}.\n`;
const SITE = "https://example.test/";
/** Git, with a last commit for every page: the date that must never show. */
const GIT_MODIFIED = "2026-11-14T09:30:00+01:00";
const git: GitDates = {
  of: async () => ({ dates: { created: "2026-01-10T10:00:00+01:00", modified: GIT_MODIFIED }, notes: [], problems: [], shallow: false }),
  statusChanged: () => {},
};

async function site(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "pd-updated-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) await save(join(root, "pages", ...rel.split("/")), body);
  return root;
}

/** Assembles `route` with a layout that declares `page` with `declared`. */
async function assemble(route: string, files: Record<string, string>, declared: string[] = [], extra: Partial<PageAssembly> = {}) {
  const root = await site(files);
  const patterns = join(root, "patterns");
  const props = Object.fromEntries(declared.map(k => [k, {}]));
  for (const [rel, body] of Object.entries({
    "layouts/page/page.hbs": "<main><h1>{{title}}</h1>{{{body}}}{{#if page.updated}}<p>Updated <time>{{page.updated}}</time></p>{{/if}}</main>",
    "layouts/page/page.schema.json": JSON.stringify({ properties: { title: { type: "string" }, page: { type: "object", properties: props } } }),
  })) await save(join(patterns, ...rel.split("/")), body);
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
  const inputs: RenderInput[] = [];
  const model = await readPages(join(root, "pages"));
  const p = await assemblePage(route, model, {
    discoveryMap, handleMap, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap),
    site: undefined, workbenchUrl: "https://wb.example/", shown: x => x, head: async () => "",
    image: async () => ({ ok: false, message: "no images here" }), dates: git, siteUrl: SITE,
    render: input => { inputs.push(input); return render(input); }, ...extra,
  } as PageAssembly);
  return { page: p, model, data: (inputs.at(-1)?.data as { page?: Record<string, unknown> } | undefined)?.page };
}
const graphOf = (html: string): Array<Record<string, unknown>> =>
  JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!)["@graph"];
const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));

const FILES = {
  "index.md": page("Home"),
  "articles/index.md": page("Articles"),
  "articles/fresh.md": page("Fresh", "date: 2026-10-01\nupdated: 2026-11-02\n"),
  "articles/plain.md": page("Plain", "date: 2026-10-05\n"),
  "about.md": page("About", "updated: 2026-09-01\n"),
};

describe("updated: the frontmatter key", () => {
  it("is a real date, written YYYY-MM-DD", async () => {
    const { page: p } = await assemble("/", { "index.md": page("Home", "updated: 2026-02-30\n") });
    expect(p.problems).toEqual([`index.md:3: updated "2026-02-30" is not a date: write it YYYY-MM-DD, such as "2026-11-14"`]);
  });

  it("is never before the page's own date; the same day is fine", async () => {
    const { page: p } = await assemble("/", { "index.md": page("Home", "date: 2026-11-02\nupdated: 2026-11-01\n") });
    expect(p.problems).toEqual([`index.md:4: updated 2026-11-01 is before the page's date, 2026-11-02: a page is updated after it is published`]);
    expect((await assemble("/", { "index.md": page("Home", "date: 2026-11-02\nupdated: 2026-11-02\n") })).page.problems).toEqual([]);
  });

  it("is the build's: a layout can't declare it", async () => {
    const root = await site({ "index.md": page("Home") });
    const patterns = join(root, "patterns");
    await save(join(patterns, "layouts/page/page.hbs"), "<main><h1>{{title}}</h1></main>");
    await save(join(patterns, "layouts/page/page.schema.json"), JSON.stringify({ properties: { title: { type: "string" }, updated: { type: "string" } } }));
    const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
    const p = await assemblePage("/", await readPages(join(root, "pages")), {
      discoveryMap, handleMap, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap), site: undefined,
      workbenchUrl: "https://wb.example/", shown: x => x, head: async () => "", image: async () => ({ ok: false, message: "-" }),
      render: createRenderer({ patternsDir: patterns, discoveryMap, handleMap }),
    } as PageAssembly);
    expect(p.problems).toContain(`index.md: layout "page" declares "updated", which a page sets for the build, not for its layout: rename it in the layout's schema`);
  });
});

describe("page.updated", () => {
  it("is the page's updated, else null: never git's last commit", async () => {
    const fresh = await assemble("/articles/fresh/", FILES, ["updated"]);
    expect(fresh.page.problems).toEqual([]);
    expect(fresh.data).toEqual({ updated: "2026-11-02" });
    expect(fresh.page.html).toContain("<p>Updated <time>2026-11-02</time></p>");
    expect((await assemble("/articles/plain/", FILES, ["updated"])).data).toEqual({ updated: null });
  });

  it("is on a listing entry too", async () => {
    const { data } = await assemble("/articles/", FILES, ["children"]);
    expect((data?.["children"] as Array<{ route: string; updated: unknown }>).map(e => [e.route, e.updated])).toEqual([
      ["/articles/fresh/", "2026-11-02"], ["/articles/plain/", null]]);
  });

  it("replaces page.modified, which a layout can no longer declare", async () => {
    const { page: p } = await assemble("/", FILES, ["modified"]);
    expect(p.status).toBe(500);
    expect(p.problems).toEqual([`layouts/page declares "page.modified", which Pattern Dump no longer fills: git's last commit `
      + `counts a typo fix as a change. Declare "page.updated" instead: the page's own updated: date, set for real changes`]);
  });
});

describe("dateModified, article:modified_time", () => {
  it("are the page's updated, on its WebPage and its Article", async () => {
    const html = (await assemble("/articles/fresh/", FILES)).page.html;
    const [, webPage, article] = graphOf(html);
    expect(webPage).toMatchObject({ datePublished: "2026-10-01", dateModified: "2026-11-02" });
    expect(article).toMatchObject({ "@type": "Article", datePublished: "2026-10-01", dateModified: "2026-11-02" });
    expect(headOf(html)).toContain(`<meta property="article:published_time" content="2026-10-01">\n<meta property="article:modified_time" content="2026-11-02">`);
  });

  it("are left out without updated, though git has a last commit for the page", async () => {
    const html = (await assemble("/articles/plain/", FILES)).page.html;
    for (const node of graphOf(html)) expect(node, String(node["@type"])).not.toHaveProperty("dateModified");
    expect(html).not.toContain("article:modified_time");
    expect(html).not.toContain(GIT_MODIFIED);
  });

  it("article:modified_time is an article's only; a page that is not one has dateModified alone", async () => {
    const html = (await assemble("/about/", FILES)).page.html;
    expect(graphOf(html)[1]).toMatchObject({ dateModified: "2026-09-01" });
    expect(html).not.toContain("article:");
  });
});

describe("the sitemap's lastmod", () => {
  it("is updated, else the page's own date, else left out; never git's", async () => {
    const model = await readPages(join(await site({ ...FILES, "hidden.md": page("Hidden", "index: false\nupdated: 2026-11-01\n") }), "pages"));
    expect(sitemapEntries(model, SITE)).toEqual([
      { url: "https://example.test/", lastmod: null },
      { url: "https://example.test/about/", lastmod: "2026-09-01" },
      { url: "https://example.test/articles/", lastmod: null },
      { url: "https://example.test/articles/fresh/", lastmod: "2026-11-02" },
      { url: "https://example.test/articles/plain/", lastmod: "2026-10-05" },
    ]);
  });
});
