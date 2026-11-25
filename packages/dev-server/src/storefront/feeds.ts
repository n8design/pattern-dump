// Feeds: a collection's newest pages, and the site's across its collections, as Atom 1.0 (RFC 4287) or RSS 2.0.
//
// This module writes the documents from a Feed, and checks what each format requires first (checkFeed). Which feeds a
// site has, and their entries, are worked out from the page model elsewhere; nothing here reads a file or the clock,
// so the same Feed is the same bytes.
//
// - Dates are days (YYYY-MM-DD). Atom wants an RFC 3339 date-time, so a day is written as its midnight in UTC
//   (2026-11-13T00:00:00Z); RSS wants RFC 822, written as toUTCString writes it (Fri, 13 Nov 2026 00:00:00 GMT).
// - Every URL and id is absolute already, and written as it is: an id is compared character by character, so it is
//   never re-encoded here.
// - Text is escaped, never put in CDATA. A summary is plain text (Atom `type="text"`).
// - The feed's `updated` is given, not taken from the clock: the newest entry's, so a rebuild with no change writes
//   the same feed.

import { FEED_FILES } from "@pattern-dump/contracts";
import { entriesOf, type Entry } from "./collections.js";
import type { DatesMode, GitDates } from "./git-dates.js";
import { readFeed } from "./listing-keys.js";
import type { PageModel } from "./pages.js";
import { escapeXml } from "./xml.js";

/** A feed's author (Atom's person construct: a name, and a page about them). */
export interface FeedPerson { name: string; uri?: string | undefined }

export interface FeedEntry {
  /** The entry's id: an absolute URL that never changes (the page's oldest route). */
  id: string;
  title: string;
  /** The page's URL now. */
  url: string;
  /** The page's date, YYYY-MM-DD. */
  published: string;
  /** The page's own updated, else its date, YYYY-MM-DD. */
  updated: string;
  /** The teaser: the page's description, else its first paragraph; null without either. */
  summary: string | null;
}

export interface Feed {
  /** Where the feed comes from, as messages name it: the collection's index.md, or "site.feeds". */
  source: string;
  /** The feed's id: an absolute URL that never changes (the collection's page, or the site's address). */
  id: string;
  title: string;
  /** The collection's description; RSS requires one. */
  subtitle?: string | null | undefined;
  /** The page the feed is the feed of: the collection's page, or the home page. */
  home: string;
  /** The newest entry's updated, YYYY-MM-DD. */
  updated: string;
  author?: FeedPerson | undefined;
  /** The site's language, for RSS's `language` (Atom has none of its own). */
  language?: string | undefined;
  entries: FeedEntry[];
}

export type FeedFormat = "atom" | "rss";

/** The media type each format is served as. */
export const FEED_TYPES: Readonly<Record<FeedFormat, string>> = { atom: "application/atom+xml", rss: "application/rss+xml" };

/** What `format` requires that `feed` lacks, one line each, naming where to give it; empty when it can be written. */
export function checkFeed(feed: Feed, format: FeedFormat): string[] {
  const problems: string[] = [];
  if (!feed.title.trim()) problems.push(`${feed.source}: the feed has no title: give it one`);
  // RFC 4287 4.1.1: a feed has an author, unless every entry has one; no entry has one of its own here.
  if (format === "atom" && !feed.author?.name.trim()) {
    problems.push(`${feed.source}: an Atom feed needs an author: set site.feeds.author.name`);
  }
  // RSS 2.0, the required channel elements: title, link and description.
  if (format === "rss" && !feed.subtitle?.trim()) {
    problems.push(`${feed.source}: an RSS feed needs a description: give ${feed.source === "site.feeds" ? "the home page" : "the folder's index.md"} a description`);
  }
  return problems;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A day as RFC 3339 wants it in Atom: its midnight in UTC. */
export function atomDate(day: string): string {
  if (!DAY.test(day)) throw new Error(`not a day: ${day}`);
  return `${day}T00:00:00Z`;
}
/** A day as RSS wants it (RFC 822, the four-digit year, GMT). */
export function rssDate(day: string): string {
  const m = DAY.exec(day);
  if (!m) throw new Error(`not a day: ${day}`);
  const d = new Date(0);
  d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toUTCString();
}

const t = (name: string, text: string, attrs = ""): string => `<${name}${attrs}>${escapeXml(text)}</${name}>`;
const a = (name: string, value: string | number): string => ` ${name}="${escapeXml(String(value))}"`;

/** The feed as Atom 1.0. `self`: the feed's own absolute URL. */
export function atomXml(feed: Feed, self: string): string {
  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom">`,
    `  ${t("id", feed.id)}`,
    `  ${t("title", feed.title, a("type", "text"))}`,
    ...(feed.subtitle ? [`  ${t("subtitle", feed.subtitle, a("type", "text"))}`] : []),
    `  ${t("updated", atomDate(feed.updated))}`,
    ...(feed.author ? [`  <author>${t("name", feed.author.name)}${feed.author.uri ? t("uri", feed.author.uri) : ""}</author>`] : []),
    `  <link${a("rel", "alternate")}${a("type", "text/html")}${a("href", feed.home)}/>`,
    `  <link${a("rel", "self")}${a("type", FEED_TYPES.atom)}${a("href", self)}/>`,
    `  ${t("generator", "Pattern Dump")}`,
    ...feed.entries.flatMap(e => [
      `  <entry>`,
      `    ${t("id", e.id)}`,
      `    ${t("title", e.title, a("type", "text"))}`,
      `    <link${a("rel", "alternate")}${a("type", "text/html")}${a("href", e.url)}/>`,
      `    ${t("published", atomDate(e.published))}`,
      `    ${t("updated", atomDate(e.updated))}`,
      ...(e.summary !== null ? [`    ${t("summary", e.summary, a("type", "text"))}`] : []),
      `  </entry>`,
    ]),
    `</feed>`,
  ];
  return `${lines.join("\n")}\n`;
}

/** The feed as RSS 2.0. `self`: the feed's own absolute URL. */
export function rssXml(feed: Feed, self: string): string {
  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<rss version="2.0"${a("xmlns:atom", "http://www.w3.org/2005/Atom")}${a("xmlns:dc", "http://purl.org/dc/elements/1.1/")}>`,
    `  <channel>`,
    `    ${t("title", feed.title)}`,
    `    ${t("link", feed.home)}`,
    `    ${t("description", feed.subtitle ?? "")}`,
    ...(feed.language ? [`    ${t("language", feed.language)}`] : []),
    `    ${t("lastBuildDate", rssDate(feed.updated))}`,
    `    ${t("generator", "Pattern Dump")}`,
    `    <atom:link${a("rel", "self")}${a("type", FEED_TYPES.rss)}${a("href", self)}/>`,
    ...feed.entries.flatMap(e => [
      `    <item>`,
      `      ${t("title", e.title)}`,
      `      ${t("link", e.url)}`,
      // The id is the page's oldest route, which is not its URL once the page has moved: never a permalink.
      `      ${t("guid", e.id, a("isPermaLink", "false"))}`,
      `      ${t("pubDate", rssDate(e.published))}`,
      ...(feed.author ? [`      ${t("dc:creator", feed.author.name)}`] : []),
      ...(e.summary !== null ? [`      ${t("description", e.summary)}`] : []),
      `    </item>`,
    ]),
    `  </channel>`,
    `</rss>`,
  ];
  return `${lines.join("\n")}\n`;
}

// ---- The site's feeds, from the page model ----

/** site.feeds as the server has it (server-config.ts, with its defaults). */
export interface SiteFeedSettings {
  format: "atom" | "rss" | "both";
  limit: number;
  collections?: readonly string[] | undefined;
  site: boolean;
  path?: string | { atom: string; rss: string } | undefined;
  author?: FeedPerson | undefined;
}

/** A feed the site has: its address (a site path, such as /articles/feed.xml), its format and its document's feed;
 *  for a collection's, its folder and the routes of its pages, which link to it. */
export interface SiteFeed { address: string; format: FeedFormat; feed: Feed; collection?: { folder: string; routes: readonly string[] } }

/** The site's own files at its root and the folders it writes, which no feed's address can be. */
const SITE_FILES = new Set(["/sitemap.xml", "/robots.txt", "/llms.txt", "/404.html"]);
const SITE_FOLDERS = ["/_pd/", "/assets/", "/preview/", "/_pagefind/"];

const formatsOf = (format: SiteFeedSettings["format"]): FeedFormat[] => format === "both" ? ["atom", "rss"] : [format];

/** Each format's file name for a feed: what the config or index.md names, else feed.xml (and rss.xml beside an Atom
 *  feed, in both formats). */
function filesOf(format: SiteFeedSettings["format"], own: { path?: string | undefined; atom?: string | undefined; rss?: string | undefined }):
  Partial<Record<FeedFormat, string>> {
  if (format === "both") return { atom: own.atom ?? FEED_FILES.atom, rss: own.rss ?? FEED_FILES.rss };
  return { [format]: own.path ?? FEED_FILES.atom };
}

/**
 * The site's feeds (summary feeds): one per folder whose index.md has `sort: date` (unless it says `feed: false`, or
 * site.feeds.collections leaves it out), of its newest `limit` pages that have a date, and the site's across them.
 * A draft, a scheduled page and a page with `index: false` is in none. `siteUrl`: the site's address, ending with
 * "/", which every URL and id starts with. A feed with no page is not written (a note). Every problem stops the
 * build: an address another file has, or what a format requires and the feed lacks (checkFeed).
 */
export async function feedsOf(model: PageModel, s: SiteFeedSettings, o: {
  siteUrl: string; siteTitle: string | undefined; lang: string; dates?: GitDates | undefined; mode: DatesMode;
}): Promise<{ feeds: SiteFeed[]; problems: string[]; notes: string[] }> {
  const problems: string[] = [], notes: string[] = [];
  const abs = (route: string) => new URL(route.slice(1), o.siteUrl).href;
  const named = (folder: string) => folder.replace(/^\/+|\/+$/g, "");
  const listed = s.collections ? new Set(s.collections) : undefined;
  for (const name of listed ?? []) {
    const listing = model.folders.get(`/${name}/`);
    if (!listing) problems.push(`site.feeds.collections names "${name}", and the pages folder has no folder "${name}" with an index.md`);
    else if (listing.sort !== "date") problems.push(`site.feeds.collections names "${name}", but ${model.files.get(`/${name}/`)?.path ?? `${name}/index.md`} has no sort: date, so its pages are not in date order: add sort: date`);
  }
  const hidden = (route: string) => model.files.get(route)?.frontmatter.values["index"] === "false";
  const toEntry = (e: Entry): FeedEntry => ({
    id: abs(e.route), title: e.title, url: abs(e.route), published: e.date!, updated: e.updated ?? e.date!, summary: e.description,
  });
  const newest = (a: Entry, b: Entry) => a.date === b.date ? (a.route < b.route ? -1 : 1) : a.date! < b.date! ? 1 : -1;
  const feeds: SiteFeed[] = [];
  const add = (feed: Feed, files: Partial<Record<FeedFormat, string>>, dir: string, collection?: SiteFeed["collection"]): void => {
    for (const format of formatsOf(s.format)) {
      problems.push(...checkFeed(feed, format));
      feeds.push({ address: `${dir}${files[format]!}`, format, feed, ...(collection ? { collection } : {}) });
    }
  };
  const updatedOf = (entries: readonly FeedEntry[]) => entries.reduce((max, e) => e.updated > max ? e.updated : max, entries[0]!.updated);
  const all = new Map<string, Entry>();

  for (const [folder, listing] of [...model.folders].sort(([a], [b]) => a.localeCompare(b))) {
    const file = model.files.get(folder);
    if (!file) continue;
    const value = file.frontmatter.values["feed"], map = file.frontmatter.maps?.["feed"];
    const own = value === undefined && map === undefined ? { ok: true as const, value: undefined } : readFeed(value, map, file.path);
    // A feed: that can't be read is the index.md's own problem (its page check names it).
    if (!own.ok) continue;
    if (listing.sort !== "date") {
      if (own.value !== undefined && own.value !== false) {
        problems.push(`${file.path}: feed is set, but a folder gets a feed only with sort: date: add sort: date, or remove feed`);
      }
      continue;
    }
    if (own.value === false || (listed && !listed.has(named(folder)))) continue;
    const settings = own.value ?? {};
    if (s.format === "both" && settings.path !== undefined) {
      problems.push(`${file.path}: feed.path names a feed in one format, and site.feeds.format is "both": name each, with feed.atom and feed.rss`);
      continue;
    }
    if (s.format !== "both" && (settings.atom !== undefined || settings.rss !== undefined)) {
      problems.push(`${file.path}: feed.atom and feed.rss name a feed in both formats, and site.feeds.format is "${s.format}": give feed.path`);
      continue;
    }
    const got = await entriesOf(folder, model, { dates: o.dates, mode: o.mode });
    problems.push(...got.problems);
    const dated = got.entries.filter(e => e.date !== null && !e.draft && !e.scheduled && !hidden(e.route));
    for (const e of dated) all.set(e.route, e);
    const entries = dated.slice(0, settings.limit ?? s.limit).map(toEntry);
    if (!entries.length) { notes.push(`${file.path}: sort: date, and no page with a date yet, so no feed`); continue; }
    const page = model.pages.find(p => p.route === folder);
    add({
      source: file.path, id: abs(folder), title: page?.title ?? named(folder), subtitle: model.entries.get(folder)?.description ?? null,
      home: abs(folder), updated: updatedOf(entries), author: s.author, language: o.lang, entries,
    }, filesOf(s.format, settings), folder, { folder, routes: listing.children });
  }

  if (s.site && all.size) {
    const entries = [...all.values()].sort(newest).slice(0, s.limit).map(toEntry);
    const own = typeof s.path === "string" ? { path: s.path } : s.path ?? {};
    add({
      source: "site.feeds", id: o.siteUrl, title: o.siteTitle ?? model.pages.find(p => p.route === "/")?.title ?? "",
      subtitle: model.entries.get("/")?.description ?? null, home: o.siteUrl, updated: updatedOf(entries), author: s.author,
      language: o.lang, entries,
    }, filesOf(s.format, own), "/");
  }

  // Each address once, and none another file of the site's: a page or an old route under it, or a root file.
  const routes = [...model.pages.map(p => p.route), ...model.pages.flatMap(p => p.redirectFrom ?? [])];
  const seen = new Map<string, string>();
  for (const { address, feed } of feeds) {
    const other = seen.get(address);
    if (other !== undefined && other !== feed.source) {
      problems.push(`${feed.source}: its feed is ${address}, which is ${other}'s feed too: give one of them another file name, or turn one off`);
      continue;
    }
    seen.set(address, feed.source);
    const clash = SITE_FILES.has(address) ? `the site's ${address.slice(1)}`
      : SITE_FOLDERS.some(f => address.startsWith(f)) ? `in ${address.split("/")[1]}/, which Pattern Dump writes`
      : routes.find(r => r === `${address}/` || r.startsWith(`${address}/`));
    if (clash) problems.push(`${feed.source}: its feed is ${address}, which is ${clash.startsWith("/") ? `the page ${clash}` : clash}: give the feed another file name`);
  }
  return { feeds, problems: [...new Set(problems)], notes };
}

/** A link to a feed in a page's head: its absolute URL, media type and title. */
export interface FeedLink { href: string; type: string; title: string }

/**
 * The feeds a page links to in its head: the site's feed on every page, and a collection's feed on the collection's
 * own page and on each of its pages. `siteTitle` ends each collection feed's title ("Articles · Bench").
 */
export function feedLinksFor(route: string, feeds: readonly SiteFeed[], siteUrl: string, siteTitle: string | undefined): FeedLink[] {
  const link = (f: SiteFeed): FeedLink => ({ href: new URL(f.address.slice(1), siteUrl).href, type: FEED_TYPES[f.format],
    title: f.collection && siteTitle ? `${f.feed.title} · ${siteTitle}` : f.feed.title });
  return [
    ...feeds.filter(f => !f.collection).map(link),
    ...feeds.filter(f => f.collection && (f.collection.folder === route || f.collection.routes.includes(route))).map(link),
  ];
}

/** feedsOf, once per page model and site address: every page of a render asks for its links. */
const cached = new WeakMap<PageModel, Map<string, ReturnType<typeof feedsOf>>>();
export function cachedFeedsOf(...args: Parameters<typeof feedsOf>): ReturnType<typeof feedsOf> {
  const [model, , o] = args;
  let bySite = cached.get(model);
  if (!bySite) { bySite = new Map(); cached.set(model, bySite); }
  let got = bySite.get(o.siteUrl);
  if (!got) { got = feedsOf(...args); bySite.set(o.siteUrl, got); }
  return got;
}
