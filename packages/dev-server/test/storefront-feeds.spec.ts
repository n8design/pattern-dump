// The site's feeds (feeds.ts feedsOf, routes.ts, static-build.ts): which folders get one, which pages are in it, the
// site feed across them, a feed's file name and what it can't be, and what pd build writes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { feedLinksFor, feedsOf, type SiteFeedSettings } from "../src/storefront/feeds.js";
import { readPages } from "../src/storefront/pages.js";
import type { GitDates } from "../src/storefront/git-dates.js";
import { buildStaticSite } from "../src/static-build.js";
import { startDevServer } from "../src/index.js";
import { request } from "node:http";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-feeds-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const fm = (lines: string[], body = "Text.") => `---\n${lines.join("\n")}\n---\n\n${body}\n`;
const json = (v: unknown) => JSON.stringify(v);

/** The pages: a dated collection with a draft, a scheduled page and a hidden one; a second dated collection; a
 *  folder in the nav's order (no feed). */
const PAGES: Record<string, string> = {
  "pages/index.md": fm(["title: Home", "description: The bench's home."]),
  "pages/articles/index.md": fm(["title: Articles", "description: What we write about.", "sort: date"]),
  "pages/articles/new.md": fm(["title: New", "date: 2026-11-20", "description: The newest."]),
  "pages/articles/mid.md": fm(["title: Mid", "date: 2026-11-10", "updated: 2026-11-21"], "Its first paragraph."),
  "pages/articles/old.md": fm(["title: Old", "date: 2026-10-01"]),
  "pages/articles/draft.md": fm(["title: Draft", "date: 2026-11-22", "draft: true"]),
  "pages/articles/later.md": fm(["title: Later", "date: 2999-01-01"]),
  "pages/articles/hidden.md": fm(["title: Hidden", "date: 2026-11-15", "index: false"]),
  "pages/notes/index.md": fm(["title: Notes", "description: Short ones.", "sort: date"]),
  "pages/notes/one.md": fm(["title: One", "date: 2026-11-18"]),
  "pages/guides/index.md": fm(["title: Guides"]),
  "pages/guides/setup.md": fm(["title: Setup", "date: 2026-11-19"]),
};

let n = 0;
async function project(files: Record<string, string | null> = {}): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries({ ...PAGES, ...files })) {
    if (text === null) continue;
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  return root;
}

/** A home page with sort: date, which lists the folders' index.md files too: so they get dates. */
const DATED_HOME: Record<string, string> = {
  "pages/index.md": fm(["title: Home", "sort: date"]),
  "pages/articles/index.md": fm(["title: Articles", "description: What we write about.", "sort: date", "date: 2026-09-01"]),
  "pages/notes/index.md": fm(["title: Notes", "description: Short ones.", "sort: date", "date: 2026-09-01"]),
  "pages/guides/index.md": fm(["title: Guides", "date: 2026-09-01"]),
};

const SETTINGS: SiteFeedSettings = { format: "atom", limit: 20, site: true, author: { name: "The bench" } };
const SITE = "https://example.test/";

/** The feeds of a project's pages as pd build reads them (no draft, no scheduled page). */
async function feeds(files: Record<string, string | null> = {}, s: Partial<SiteFeedSettings> = {}, mode: "build" | "dev" = "build",
  dates?: GitDates) {
  const root = await project(files);
  const leave = mode === "build" ? "leave-out" : "show";
  const model = await readPages(join(root, "pages"), { drafts: leave, scheduled: leave, today: "2026-11-25" });
  return feedsOf(model, { ...SETTINGS, ...s }, { siteUrl: SITE, siteTitle: "Bench", lang: "en-GB", mode, dates });
}
/** Git as far as the feeds ask it: where each page was first committed (`first`, by its path now). */
const gitWith = (first: Record<string, string>): GitDates => ({
  of: async () => ({ dates: { created: null, modified: null }, notes: [], problems: [], shallow: false }),
  statusChanged() { /* nothing to forget */ },
  oldestOf: async path => first[path] ?? path,
});

describe("which feeds a site has", () => {
  it("one per folder with sort: date, at <folder>/feed.xml, and the site's at /feed.xml", async () => {
    const r = await feeds();
    expect(r.problems).toEqual([]);
    expect(r.feeds.map(f => [f.address, f.format])).toEqual([["/articles/feed.xml", "atom"], ["/notes/feed.xml", "atom"], ["/feed.xml", "atom"]]);
    const articles = r.feeds[0]!.feed;
    expect(articles).toMatchObject({ source: "articles/index.md", id: "https://example.test/articles/", title: "Articles",
      subtitle: "What we write about.", home: "https://example.test/articles/", author: { name: "The bench" }, language: "en-GB" });
  });

  it("lists a collection's dated pages newest first: no draft, no scheduled page, no page with index: false", async () => {
    const articles = (await feeds()).feeds[0]!.feed;
    expect(articles.entries.map(e => e.title)).toEqual(["New", "Mid", "Old"]);
    expect(articles.entries[1]).toEqual({ id: "https://example.test/articles/mid/", title: "Mid", url: "https://example.test/articles/mid/",
      published: "2026-11-10", updated: "2026-11-21", summary: "Its first paragraph." });
    // The feed's updated is its newest entry's updated, never the clock.
    expect(articles.updated).toBe("2026-11-21");
    // pd dev lists drafts and scheduled pages; a feed never does.
    expect((await feeds({}, {}, "dev")).feeds[0]!.feed.entries.map(e => e.title)).toEqual(["New", "Mid", "Old"]);
  });

  it("the site feed: the collections' pages together, newest first, to the limit", async () => {
    const site = (await feeds({}, { limit: 3 })).feeds.at(-1)!.feed;
    expect(site).toMatchObject({ source: "site.feeds", id: SITE, title: "Bench", subtitle: "The bench's home.", home: SITE });
    expect(site.entries.map(e => e.title)).toEqual(["New", "One", "Mid"]);
    expect((await feeds({}, { limit: 1 })).feeds.map(f => f.feed.entries.length)).toEqual([1, 1, 1]);
    expect((await feeds({}, { site: false })).feeds.map(f => f.address)).toEqual(["/articles/feed.xml", "/notes/feed.xml"]);
  });

  it("feed: false turns a folder's feed off; site.feeds.collections keeps only the ones it names", async () => {
    const off = await feeds({ "pages/notes/index.md": fm(["title: Notes", "sort: date", "feed: false"]) });
    expect(off.feeds.map(f => f.address)).toEqual(["/articles/feed.xml", "/feed.xml"]);
    expect(off.feeds.at(-1)!.feed.entries.map(e => e.title)).toEqual(["New", "Mid", "Old"]);
    expect((await feeds({}, { collections: ["notes"] })).feeds.map(f => f.address)).toEqual(["/notes/feed.xml", "/feed.xml"]);
    expect((await feeds({}, { collections: ["guides", "nope"] })).problems).toEqual([
      `site.feeds.collections names "guides", but guides/index.md has no sort: date, so its pages are not in date order: add sort: date`,
      `site.feeds.collections names "nope", and the pages folder has no folder "nope" with an index.md`,
    ]);
  });

  it("a folder's limit; a folder with no dated page yet has no feed, and a note says so", async () => {
    const r = await feeds({ "pages/articles/index.md": fm(["title: Articles", "description: D.", "sort: date", "feed:", "  limit: 1"]),
      "pages/notes/one.md": fm(["title: One"]) }, {}, "dev");
    expect(r.feeds.map(f => [f.address, f.feed.entries.length])).toEqual([["/articles/feed.xml", 1], ["/feed.xml", 3]]);
    expect(r.notes).toEqual(["notes/index.md: sort: date, and no page with a date yet, so no feed"]);
  });

  it("feed set on a folder without sort: date is a problem", async () => {
    expect((await feeds({ "pages/guides/index.md": fm(["title: Guides", "feed: true"]) })).problems).toEqual([
      "guides/index.md: feed is set, but a folder gets a feed only with sort: date: add sort: date, or remove feed"]);
    expect((await feeds({ "pages/guides/index.md": fm(["title: Guides", "feed: false"]) })).problems).toEqual([]);
  });

  it("checks what the format requires: RSS needs each feed's description", async () => {
    const r = await feeds({ "pages/notes/index.md": fm(["title: Notes", "sort: date"]) }, { format: "rss" });
    // notes/index.md has no description of its own, so its first paragraph is the feed's ("Text.").
    expect(r.problems).toEqual([]);
    const bare = await feeds({ "pages/notes/index.md": `---\ntitle: Notes\nsort: date\n---\n` }, { format: "rss" });
    expect(bare.problems).toEqual(["notes/index.md: an RSS feed needs a description: give the folder's index.md a description"]);
  });
});

describe("an entry's id", () => {
  it("is the page's first redirectFrom, absolute, else its route; the link is the page's URL now", async () => {
    const r = await feeds({ "pages/articles/mid.md": fm(["title: Mid", "date: 2026-11-10", "redirectFrom: [/articles/middle/, /mid/]"]) });
    const mid = r.feeds[0]!.feed.entries.find(e => e.title === "Mid")!;
    expect([mid.id, mid.url]).toEqual(["https://example.test/articles/middle/", "https://example.test/articles/mid/"]);
    expect(r.feeds[0]!.feed.entries.find(e => e.title === "New")!.id).toBe("https://example.test/articles/new/");
  });

  it("says when git first saw a page at another route than its id's, once, and nothing when they agree", async () => {
    const moved = fm(["title: Mid", "date: 2026-11-10", "redirectFrom: [/mid/, /articles/middle/]"]);
    const r = await feeds({ "pages/articles/mid.md": moved }, {}, "build", gitWith({ "articles/mid.md": "articles/middle.md" }));
    expect(r.notes).toEqual(["articles/mid.md: git first saw this page at /articles/middle/, but its feed entry's id is from /mid/: "
      + "list /articles/middle/ first in redirectFrom (the original first), so a feed reader knows it as the same entry"]);
    const right = fm(["title: Mid", "date: 2026-11-10", "redirectFrom: [/articles/middle/, /mid/]"]);
    expect((await feeds({ "pages/articles/mid.md": right }, {}, "build", gitWith({ "articles/mid.md": "articles/middle.md" }))).notes).toEqual([]);
    // A page that never moved, with no redirectFrom: nothing to say.
    expect((await feeds({}, {}, "build", gitWith({}))).notes).toEqual([]);
  });
});

describe("a feed's file name", () => {
  it("is feed.xml, or what the config and the folder's index.md name; in both formats, one per format", async () => {
    const named = await feeds({ "pages/articles/index.md": fm(["title: Articles", "description: D.", "sort: date", "feed:", "  path: index.xml"]) },
      { format: "rss", path: "rss.xml" });
    expect(named.problems).toEqual([]);
    expect(named.feeds.map(f => [f.address, f.format])).toEqual([["/articles/index.xml", "rss"], ["/notes/feed.xml", "rss"], ["/rss.xml", "rss"]]);
    const both = await feeds({ "pages/articles/index.md": fm(["title: Articles", "description: D.", "sort: date", "feed:", "  atom: atom.xml", "  rss: index.xml"]) },
      { format: "both" });
    expect(both.feeds.map(f => [f.address, f.format])).toEqual([
      ["/articles/atom.xml", "atom"], ["/articles/index.xml", "rss"], ["/notes/feed.xml", "atom"], ["/notes/rss.xml", "rss"], ["/feed.xml", "atom"], ["/rss.xml", "rss"]]);
  });

  it("refuses a folder's names that don't fit the site's format", async () => {
    expect((await feeds({ "pages/articles/index.md": fm(["title: Articles", "sort: date", "feed:", "  path: index.xml"]) }, { format: "both" })).problems)
      .toEqual([`articles/index.md: feed.path names a feed in one format, and site.feeds.format is "both": name each, with feed.atom and feed.rss`]);
    expect((await feeds({ "pages/articles/index.md": fm(["title: Articles", "sort: date", "feed:", "  atom: a.xml", "  rss: b.xml"]) })).problems)
      .toEqual([`articles/index.md: feed.atom and feed.rss name a feed in both formats, and site.feeds.format is "atom": give feed.path`]);
  });

  it("refuses an address another feed, an old route or a file of the site's has", async () => {
    // The home page's own feed and the site feed, both /feed.xml.
    const home = await feeds(DATED_HOME);
    expect(home.problems).toEqual(["site.feeds: its feed is /feed.xml, which is index.md's feed too: give one of them another file name, or turn one off"]);
    // A page's route can't be one (a page's file name has no dot), but an old route a page forwards from can.
    const moved = await feeds({ "pages/notes/one.md": fm(["title: One", "date: 2026-11-18", "redirectFrom: [/feed.xml/]"]) });
    expect(moved.problems).toEqual(["site.feeds: its feed is /feed.xml, which is the page /feed.xml/: give the feed another file name"]);
    // A file the site writes at its root.
    expect((await feeds({}, { path: "sitemap.xml" })).problems).toEqual([
      "site.feeds: its feed is /sitemap.xml, which is the site's sitemap.xml: give the feed another file name"]);
  });
});

describe("pd build writes them", { timeout: 60_000 }, () => {
  const PATTERNS: Record<string, string> = {
    "src/patterns/layouts/page/page.hbs": "<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>\n",
    "src/patterns/layouts/page/page.schema.json": json({ properties: { title: { type: "string" }, description: { type: "string" } } }),
    "src/styles/x.scss": "",
  };
  const configFor = (site: Record<string, unknown>) => validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" },
    site: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/", ...site },
  } as never), "test");
  const now = new Date("2026-11-25T12:00:00Z");

  it("writes each feed under its name, parsed as the format it says; the report counts them", async () => {
    const root = await project({ ...PATTERNS, "pages/articles/index.md": fm(["title: Articles", "description: What we write about.", "sort: date", "feed:", "  path: index.xml"]) });
    const report = await buildStaticSite(configFor({ url: SITE, feeds: { format: "rss", author: { name: "The bench" } } }), root,
      { outDir: join(root, "dist"), now });
    expect(report.feeds).toEqual({ files: 3 });
    const articles = await readFile(join(root, "site", "articles", "index.xml"), "utf8");
    expect(articles).toMatch(/^<\?xml version="1.0" encoding="utf-8"\?>\n<rss version="2.0"/);
    expect([...articles.matchAll(/<item>\s*<title>([^<]+)<\/title>/g)].map(m => m[1])).toEqual(["New", "Mid", "Old"]);
    expect(articles).toContain(`<atom:link rel="self" type="application/rss+xml" href="https://example.test/articles/index.xml"/>`);
    expect(existsSync(join(root, "site", "notes", "feed.xml"))).toBe(true);
    expect(existsSync(join(root, "site", "feed.xml"))).toBe(true);
    // Not a page: the report's page count leaves the feeds out.
    expect(report.storefront?.pages).toBe(10);
  });

  it("writes none without site.url, and the note says so", async () => {
    const root = await project(PATTERNS);
    const report = await buildStaticSite(configFor({ feeds: { author: { name: "The bench" } } }), root, { outDir: join(root, "dist"), now });
    expect(report.feeds).toBeUndefined();
    expect(existsSync(join(root, "site", "feed.xml"))).toBe(false);
    expect(report.notes).toContain(`site.url is not set, so pages have no canonical URL, og:url, og:image or JSON-LD, and there is no sitemap and no feed: `
      + `set site.url to the site's address, such as "https://example.com/"`);
  });

  it("stops on a feed's problem, writing nothing", async () => {
    const root = await project({ ...PATTERNS, ...DATED_HOME });
    await expect(buildStaticSite(configFor({ url: SITE, feeds: { author: { name: "The bench" } } }), root, { outDir: join(root, "dist"), now }))
      .rejects.toThrow("site.feeds: its feed is /feed.xml, which is index.md's feed too");
    expect(existsSync(join(root, "site"))).toBe(false);
  });
});

describe("pd dev serves them", { timeout: 60_000 }, () => {
  const PATTERNS: Record<string, string> = {
    "src/patterns/layouts/page/page.hbs": "<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>\n",
    "src/patterns/layouts/page/page.schema.json": json({ properties: { title: { type: "string" }, description: { type: "string" } } }),
    "src/styles/x.scss": "",
  };
  const config = (feeds: Record<string, unknown> = { format: "both", author: { name: "The bench" } }) => validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" },
    site: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/", url: SITE, feeds },
  } as never), "test");
  const get = (port: number, path: string) => new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, headers: { host: `live.localhost:${port}` } }, res => {
      let body = "";
      res.setEncoding("utf8").on("data", (c: string) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body }));
    }).on("error", reject).end();
  });

  it("the same feeds as pd build, but for the address the browser is on, as the sitemap", async () => {
    const root = await project(PATTERNS);
    await buildStaticSite(config(), root, { outDir: join(root, "dist"), now: new Date("2026-11-25T12:00:00Z") });
    const server = await startDevServer(config(), root, { port: 0, wsPort: 0, live: true, today: "2026-11-25" });
    try {
      for (const [path, type] of [["/feed.xml", "application/atom+xml"], ["/rss.xml", "application/rss+xml"],
        ["/articles/feed.xml", "application/atom+xml"], ["/notes/rss.xml", "application/rss+xml"]] as const) {
        const res = await get(server.port, path);
        expect(res.status, path).toBe(200);
        expect(res.type, path).toBe(`${type}; charset=utf-8`);
        const built = await readFile(join(root, "site", ...path.split("/").filter(Boolean)), "utf8");
        expect(res.body.replaceAll(`http://live.localhost:${server.port}/`, SITE), path).toBe(built);
      }
      // An .xml address no feed has is the 404 page, as before.
      expect((await get(server.port, "/guides/feed.xml")).status).toBe(404);
    } finally { await server.close(); }
  });

  it("an edited date shows in the next response", async () => {
    const root = await project(PATTERNS);
    const server = await startDevServer(config(), root, { port: 0, wsPort: 0, live: true, today: "2026-11-25" });
    const titles = async () => [...(await get(server.port, "/articles/feed.xml")).body.matchAll(/<entry>\s*<id>[^<]*<\/id>\s*<title type="text">([^<]+)/g)].map(m => m[1]);
    try {
      expect(await titles()).toEqual(["New", "Mid", "Old"]);
      await save(join(root, "pages", "articles", "old.md"), fm(["title: Old", "date: 2026-11-24"]));
      await expect.poll(titles, { timeout: 10_000 }).toEqual(["Old", "New", "Mid"]);
    } finally { await server.close(); }
  });

  it("a feed's problem is the feed's answer, a 500 that names it; the pages still answer", async () => {
    const root = await project({ ...PATTERNS, ...DATED_HOME });
    const server = await startDevServer(config({ author: { name: "The bench" } }), root, { port: 0, wsPort: 0, live: true, today: "2026-11-25" });
    try {
      const res = await get(server.port, "/feed.xml");
      expect(res.status).toBe(500);
      expect(res.body).toBe("site.feeds: its feed is /feed.xml, which is index.md's feed too: give one of them another file name, or turn one off");
      expect((await get(server.port, "/articles/")).status).toBe(200);
    } finally { await server.close(); }
  });
});

describe("which feeds a page links to", () => {
  it("the site feed on every page; a collection's on its own page and its pages, titled with the site's", async () => {
    const { feeds: all } = await feeds({}, { format: "both" });
    const links = (route: string) => feedLinksFor(route, all, SITE, "Bench").map(l => `${l.type} ${l.title} ${l.href}`);
    const site = ["application/atom+xml Bench https://example.test/feed.xml", "application/rss+xml Bench https://example.test/rss.xml"];
    expect(links("/guides/setup/")).toEqual(site);
    const articles = ["application/atom+xml Articles · Bench https://example.test/articles/feed.xml",
      "application/rss+xml Articles · Bench https://example.test/articles/rss.xml"];
    expect(links("/articles/")).toEqual([...site, ...articles]);
    expect(links("/articles/mid/")).toEqual([...site, ...articles]);
    expect(links("/notes/one/")).toEqual([...site, "application/atom+xml Notes · Bench https://example.test/notes/feed.xml",
      "application/rss+xml Notes · Bench https://example.test/notes/rss.xml"]);
    // Without a site title, a collection's feed is titled with its own.
    expect(feedLinksFor("/articles/", all, SITE, undefined).map(l => l.title)).toEqual(["Bench", "Bench", "Articles", "Articles"]);
  });

  it("pd dev writes them in the head of a page; the 404 page has none", { timeout: 60_000 }, async () => {
    const root = await project({
      "src/patterns/layouts/page/page.hbs": "<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>\n",
      "src/patterns/layouts/page/page.schema.json": json({ properties: { title: { type: "string" }, description: { type: "string" } } }),
      "src/styles/x.scss": "",
    });
    const config = validateConfig(defineConfig({
      sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" },
      site: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/", url: SITE, feeds: { author: { name: "The bench" } } },
    } as never), "test");
    const server = await startDevServer(config, root, { port: 0, wsPort: 0, live: false, today: "2026-11-25" });
    const head = (path: string) => new Promise<string>((resolve, reject) => {
      request({ host: "127.0.0.1", port: server.port, path, headers: { host: `live.localhost:${server.port}` } }, res => {
        let body = "";
        res.setEncoding("utf8").on("data", (c: string) => { body += c; });
        res.on("end", () => resolve(/<head>[\s\S]*<\/head>/.exec(body)?.[0] ?? ""));
      }).on("error", reject).end();
    });
    try {
      const alternates = (h: string) => [...h.matchAll(/<link rel="alternate"[^>]*>/g)].map(m => m[0]);
      expect(alternates(await head("/articles/mid/"))).toEqual([
        `<link rel="alternate" type="application/atom+xml" title="Home" href="https://example.test/feed.xml">`,
        `<link rel="alternate" type="application/atom+xml" title="Articles" href="https://example.test/articles/feed.xml">`,
      ]);
      expect(alternates(await head("/guides/"))).toEqual([`<link rel="alternate" type="application/atom+xml" title="Home" href="https://example.test/feed.xml">`]);
      expect(alternates(await head("/no-such-page/"))).toEqual([]);
    } finally { await server.close(); }
  });
});
