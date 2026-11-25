// The keys a page sets for listings (collections): `date`, `tags`, `categories`, `draft`, and `sort`, `childLayout` and
// `view` on a folder's index.md.
// Reserved like `redirectFrom` and `image`: the build reads them, a layout never declares them. Each is read
// from the frontmatter's text by one function here, so the page check (frontmatter-contract.ts) and the page
// model (pages.ts) read the same value: the check reports what is wrong, the model takes only what is right.
//
//   date: 2026-11-02          a real calendar date, written YYYY-MM-DD
//   updated: 2026-11-10       the same, set by the author for a real content change; never before `date`
//   tags: [design, css]       each lowercase letters, digits and hyphens (a URL segment), no duplicates; declared in
//                             storefront.tags (or an old key of one) when the site declares tags
//   categories: [guides]      each declared in storefront.categories (or an old key of one), no duplicates
//   draft: true               true or false
//   sort: date                on a folder's index.md: its pages newest first ("order", the default: the nav's order)
//   childLayout: article      on a folder's index.md: the layout of the pages under it that name none (the nearest wins)
//   view: grid                on a folder's index.md: how its listing is shown (a component in the skin's views/)

import { suggest } from "@pattern-dump/config";
import type { FrontmatterValue } from "../frontmatter.js";
import { TERM_WORDS, type CategoryIndex, type TermIndex } from "./categories.js";

export type Read<T> = { ok: true; value: T } | { ok: false; message: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A tag is a URL segment, as a page's file name is. */
const TAG = /^[a-z0-9-]+$/;
const show = (v: FrontmatterValue): string => Array.isArray(v) ? `[${v.join(", ")}]` : `"${v}"`;

/** A real calendar day, written YYYY-MM-DD. */
function isDay(v: string): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** An ISO date-time (a time after the day, with an offset, `Z` or neither): its day as written, YYYY-MM-DD. */
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)?$/i;
/** An email-style date (RFC 822, as feeds and Hugo write it): `Thu, 13 Nov 2026 23:30:00 -0800`. */
const EMAIL_DATE = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+\d{2}:\d{2}(?::\d{2})?(?:\s*(?:[+-]\d{4}|[A-Za-z]{1,5}))?)?$/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The day a date-time or an email-style date is written for, in its own offset (never the UTC day); undefined for
 *  any other form, and for a day that doesn't exist. */
function dayAsWritten(v: string): { day: string; form: "time" | "email" } | undefined {
  const iso = DATE_TIME.exec(v);
  if (iso) return isDay(iso[1]!) ? { day: iso[1]!, form: "time" } : undefined;
  const email = EMAIL_DATE.exec(v);
  if (!email) return undefined;
  const month = MONTHS.indexOf(email[2]!.toLowerCase());
  if (month < 0) return undefined;
  const day = `${email[3]}-${String(month + 1).padStart(2, "0")}-${email[1]!.padStart(2, "0")}`;
  return isDay(day) ? { day, form: "email" } : undefined;
}

/**
 * `key`: the key the value is under, for the message (`date`, `updated`). Only `YYYY-MM-DD` is a date. For a form
 * that names a day (a date-time, an email-style date), the message names that day as written, in the value's own
 * offset: `2026-11-13T23:30:00-08:00` is 13 November, although it is 14 November in UTC.
 */
export function readDate(v: FrontmatterValue, key = "date"): Read<string> {
  if (typeof v === "string" && isDay(v)) return { ok: true, value: v };
  const generic = `${key} ${show(v)} is not a date: write it YYYY-MM-DD, such as "2026-11-14"`;
  if (typeof v !== "string") return { ok: false, message: generic };
  // A "#" after the value: frontmatter has no comments, so it is part of the value.
  const hash = /\s+#/.exec(v);
  if (hash) {
    const before = v.slice(0, hash.index).trim().replace(/^(["'])(.*)\1$/, "$2").replace(/^["']/, "");
    const named = isDay(before) ? { day: before } : dayAsWritten(before);
    return { ok: false, message: `${key} ${show(v)}: a "#" starts no comment in frontmatter, so "${v.slice(hash.index).trim()}" is part `
      + `of the value: remove it${named ? `, and write the day only: ${key}: ${named.day}` : ""}` };
  }
  const named = dayAsWritten(v);
  if (named?.form === "time") {
    return { ok: false, message: `${key} ${show(v)} has a time: a page's ${key} is a day, so write the day only, as written: ${key}: ${named.day}` };
  }
  if (named?.form === "email") {
    return { ok: false, message: `${key} ${show(v)} is an email-style date: write the day only, YYYY-MM-DD: ${key}: ${named.day}` };
  }
  return { ok: false, message: generic };
}

/** `updated: YYYY-MM-DD`: a date, and not before the page's own `date` (`published`, when it has a valid one). */
export function readUpdated(v: FrontmatterValue, published: string | undefined): Read<string> {
  const r = readDate(v, "updated");
  if (r.ok && published !== undefined && r.value < published) {
    return { ok: false, message: `updated ${r.value} is before the page's date, ${published}: a page is updated after it is published` };
  }
  return r;
}

export function readTags(v: FrontmatterValue): Read<string[]> {
  const list = Array.isArray(v) ? v : [v];
  const bad = list.filter(t => !TAG.test(t));
  if (bad.length) {
    return { ok: false, message: `tags: ${bad.map(t => `"${t}"`).join(", ")} ${bad.length === 1 ? "is" : "are"} not a tag: `
      + `a tag is lowercase letters, digits and hyphens, such as "design-systems"` };
  }
  const twice = [...new Set(list.filter((t, i) => list.indexOf(t) !== i))];
  if (twice.length) return { ok: false, message: `tags: ${twice.map(t => `"${t}"`).join(", ")} ${twice.length === 1 ? "is" : "are"} listed twice` };
  return { ok: true, value: list };
}

/** A page's terms of one kind, resolved: their keys, in the page's order; `renamed`: each old key the page used. */
export interface PageTerms { keys: string[]; renamed: Array<{ from: string; to: string }> }
/** A page's categories, resolved. */
export type PageCategories = PageTerms;

/**
 * `tags:` or `categories:` (one value, or a list): each a declared key or an old key of one (categories.ts). Tags a
 * site doesn't declare are any URL segments, as readTags reads them.
 */
export function readTerms(v: FrontmatterValue, index: TermIndex): Read<PageTerms> {
  if (!index.declared) {
    const r = readTags(v);
    return r.ok ? { ok: true, value: { keys: r.value, renamed: [] } } : r;
  }
  const w = TERM_WORDS[index.kind];
  const list = Array.isArray(v) ? v : [v];
  const keys: string[] = [], renamed: PageTerms["renamed"] = [];
  const problems: string[] = [];
  for (const value of list) {
    if (!TAG.test(value)) {
      problems.push(`"${value}" is not a ${w.one}: a ${w.one} is lowercase letters, digits and hyphens, such as "design-systems"`);
      continue;
    }
    const key = index.byKey.has(value) ? value : index.aliases.get(value);
    if (key === undefined) {
      const known = [...index.byKey.keys()];
      const near = suggest(value, [...known, ...index.aliases.keys()]);
      const hint = near ? `did you mean "${index.aliases.get(near) ?? near}"?`
        : known.length ? `the ${w.many} are ${[...known].sort().map(k => `"${k}"`).join(", ")} (${w.config})`
          : `the site declares none (${w.config} in the config)`;
      problems.push(`"${value}" is not a ${w.one}: ${hint}`);
      continue;
    }
    if (key !== value) renamed.push({ from: value, to: key });
    if (keys.includes(key)) {
      const old = list.filter(x => x !== key && index.aliases.get(x) === key);
      problems.push(`"${key}" is listed twice${old.length ? ` (${old.map(o => `"${o}"`).join(", ")} is its old key)` : ""}`);
      continue;
    }
    keys.push(key);
  }
  return problems.length ? { ok: false, message: `${w.many}: ${problems.join("; ")}` } : { ok: true, value: { keys, renamed } };
}

/** `categories: [a, b]` (or one value): each a declared key or an old key of one (categories.ts). */
export const readCategories = (v: FrontmatterValue, index: CategoryIndex): Read<PageCategories> => readTerms(v, index);

export function readDraft(v: FrontmatterValue): Read<boolean> {
  return v === "true" || v === "false" ? { ok: true, value: v === "true" } : { ok: false, message: "draft must be true or false" };
}

export type SortBy = "date" | "order";

/** A folder's index.md (the root's included): the pages that sort, set a default layout and name a view. */
export const isFolderIndex = (path: string): boolean => path === "index.md" || path.endsWith("/index.md");

/** `childLayout: article` on a folder's index.md: the layout of its pages that name none (the name only; whether
 *  it is a layout is checked against the patterns, in frontmatter-contract.ts). */
export function readChildLayout(v: FrontmatterValue, path: string): Read<string> {
  if (!isFolderIndex(path)) {
    return { ok: false, message: `childLayout sets the layout of a folder's pages, so it belongs on the folder's index.md, not on a page` };
  }
  return typeof v === "string" ? { ok: true, value: v } : { ok: false, message: "childLayout must be one layout name, not a list" };
}

/** `view: grid` on a folder's index.md: how its listing is shown, a component in the skin's views/ folder (whether it
 *  is one is checked against the patterns, in views.ts). */
export function readView(v: FrontmatterValue, path: string): Read<string> {
  if (!isFolderIndex(path)) {
    return { ok: false, message: `view names how a folder's pages are listed, so it belongs on the folder's index.md, not on a page` };
  }
  return typeof v === "string" ? { ok: true, value: v } : { ok: false, message: "view must be one view name, not a list" };
}

/** `path`: the page's path in the pages folder; only a folder's index.md (the root's included) sorts. */
/** A folder's own feed settings (`feed:` on its index.md): off, or its limit and its file name. `path` names a
 *  feed in one format; `atom` and `rss` each format's file, for a feed in both. */
export interface FeedSettings { limit?: number; path?: string; atom?: string; rss?: string }

const FEED_FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.xml$/;
const FEED_KEYS = ["limit", "path", "atom", "rss", "content"] as const;

/**
 * `feed` on a folder's index.md: `feed: false` turns the folder's feed off, `feed: true` leaves it on; keys indented
 * under `feed:` set its `limit`, its file name (`path`, or `atom` and `rss` for a feed in both formats), and its
 * `content`. Which format the site writes is checked where the feeds are made.
 */
export function readFeed(v: FrontmatterValue | undefined, map: Readonly<Record<string, FrontmatterValue>> | undefined, path: string): Read<false | FeedSettings> {
  if (!isFolderIndex(path)) {
    return { ok: false, message: `feed sets a folder's feed, so it belongs on the folder's index.md, not on a page` };
  }
  if (map === undefined) {
    if (v === "false") return { ok: true, value: false };
    if (v === "true") return { ok: true, value: {} };
    return { ok: false, message: `feed must be true or false, or have its settings indented under it (limit, path)` };
  }
  const out: FeedSettings = {};
  for (const [key, value] of Object.entries(map)) {
    if (!(FEED_KEYS as readonly string[]).includes(key)) {
      const near = suggest(key, [...FEED_KEYS]);
      return { ok: false, message: `feed.${key} is not a feed setting: it takes ${FEED_KEYS.filter(k => k !== "content").join(", ")}${near ? `: did you mean "${near}"?` : ""}` };
    }
    if (key === "content") {
      if (value === "summary") continue;
      return { ok: false, message: value === "full" ? `feed.content "full" is not supported yet: use "summary", or leave it out`
        : `feed.content must be "summary"` };
    }
    if (key === "limit") {
      if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return { ok: false, message: `feed.limit must be a whole number of 1 or more, such as 20` };
      out.limit = Number(value);
      continue;
    }
    if (typeof value !== "string" || !FEED_FILE.test(value)) {
      return { ok: false, message: `feed.${key} must be a file name ending in .xml, such as "index.xml"` };
    }
    out[key as "path" | "atom" | "rss"] = value;
  }
  if (out.path !== undefined && (out.atom !== undefined || out.rss !== undefined)) {
    return { ok: false, message: `feed.path names a feed in one format, feed.atom and feed.rss one in both: give one or the other` };
  }
  if ((out.atom === undefined) !== (out.rss === undefined)) {
    return { ok: false, message: `feed.atom and feed.rss name a feed in both formats, so give both, or feed.path for one` };
  }
  if (out.atom !== undefined && out.atom === out.rss) {
    return { ok: false, message: `feed.atom and feed.rss are both "${out.atom}": give each a name of its own` };
  }
  return { ok: true, value: out };
}

export function readSort(v: FrontmatterValue, path: string): Read<SortBy> {
  if (!isFolderIndex(path)) {
    return { ok: false, message: `sort orders a folder's pages, so it belongs on the folder's index.md, not on a page` };
  }
  return v === "date" || v === "order" ? { ok: true, value: v }
    : { ok: false, message: `sort must be "date" (newest first) or "order" (the folder's order, the default)` };
}
