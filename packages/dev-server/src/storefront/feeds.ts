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
