// The keys a page sets for listings (collections): `date`, `tags`, `categories`, `draft`, and `sort`, `childLayout` and
// `view` on a folder's index.md.
// Reserved like `redirectFrom` and `image`: the build reads them, a layout never declares them. Each is read
// from the frontmatter's text by one function here, so the page check (frontmatter-contract.ts) and the page
// model (pages.ts) read the same value: the check reports what is wrong, the model takes only what is right.
//
//   date: 2026-11-02          a real calendar date, written YYYY-MM-DD
//   updated: 2026-11-10       the same, set by the author for a real content change; never before `date`
//   tags: [design, css]       each lowercase letters, digits and hyphens (a URL segment), no duplicates
//   categories: [guides]      each declared in storefront.categories (or an old key of one), no duplicates
//   draft: true               true or false
//   sort: date                on a folder's index.md: its pages newest first ("order", the default: the nav's order)
//   childLayout: article      on a folder's index.md: the layout of the pages under it that name none (the nearest wins)
//   view: grid                on a folder's index.md: how its listing is shown (a component in the skin's views/)

import { suggest } from "@pattern-dump/config";
import type { FrontmatterValue } from "../frontmatter.js";
import type { CategoryIndex } from "./categories.js";

export type Read<T> = { ok: true; value: T } | { ok: false; message: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A tag is a URL segment, as a page's file name is. */
const TAG = /^[a-z0-9-]+$/;
const show = (v: FrontmatterValue): string => Array.isArray(v) ? `[${v.join(", ")}]` : `"${v}"`;

/** `key`: the key the value is under, for the message (`date`, `updated`). */
export function readDate(v: FrontmatterValue, key = "date"): Read<string> {
  const m = typeof v === "string" ? DATE.exec(v) : null;
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) return { ok: true, value: v as string };
  }
  return { ok: false, message: `${key} ${show(v)} is not a date: write it YYYY-MM-DD, such as "2026-11-14"` };
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

/** A page's categories, resolved: declared keys, in the page's order; `renamed`: each old key the page used. */
export interface PageCategories { keys: string[]; renamed: Array<{ from: string; to: string }> }

/** `categories: [a, b]` (or one value): each a declared key or an old key of one (categories.ts). */
export function readCategories(v: FrontmatterValue, index: CategoryIndex): Read<PageCategories> {
  const list = Array.isArray(v) ? v : [v];
  const keys: string[] = [], renamed: PageCategories["renamed"] = [];
  const problems: string[] = [];
  for (const value of list) {
    if (!TAG.test(value)) {
      problems.push(`"${value}" is not a category: a category is lowercase letters, digits and hyphens, such as "design-systems"`);
      continue;
    }
    const key = index.byKey.has(value) ? value : index.aliases.get(value);
    if (key === undefined) {
      const known = [...index.byKey.keys()];
      const near = suggest(value, [...known, ...index.aliases.keys()]);
      const hint = near ? `did you mean "${index.aliases.get(near) ?? near}"?`
        : known.length ? `the categories are ${[...known].sort().map(k => `"${k}"`).join(", ")} (storefront.categories)`
          : "the site declares none (storefront.categories in the config)";
      problems.push(`"${value}" is not a category: ${hint}`);
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
  return problems.length ? { ok: false, message: `categories: ${problems.join("; ")}` } : { ok: true, value: { keys, renamed } };
}

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
export function readSort(v: FrontmatterValue, path: string): Read<SortBy> {
  if (!isFolderIndex(path)) {
    return { ok: false, message: `sort orders a folder's pages, so it belongs on the folder's index.md, not on a page` };
  }
  return v === "date" || v === "order" ? { ok: true, value: v }
    : { ok: false, message: `sort must be "date" (newest first) or "order" (the folder's order, the default)` };
}
