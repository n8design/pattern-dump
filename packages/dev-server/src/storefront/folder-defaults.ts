// Folder defaults: a folder's index.md sets frontmatter for the pages under it, once, in a `childDefaults:` block.
//
//   ---
//   title: Services
//   childDefaults:
//     layout: service
//     tags: [consulting]
//     related:
//       collections: [episodes]
//       limit: 2
//   ---
//
// - **Nearest folder wins, per key.** For each key, the value of the nearest folder above the page that sets it; a
//   map (a query's options) per option. Lists are replaced, never joined: a nearer `tags: [x]` replaces `tags: [y]`.
// - **A page's own value always wins**, per key (per option for a map).
// - A folder's defaults are for the pages under it, its subfolders' index.md included: its own index.md takes its
//   parent's, as with `childLayout`. 404.md and the generated tag and category pages take none.
// - `layout` is the long form of `childLayout`: it is not merged here, pages.ts reads either as the folder's
//   default layout. Setting both on one index.md is a problem.
// - Some keys can't be defaulted (NOT_DEFAULTABLE): they name one page, or belong to a folder's own index.md. They
//   are a problem on the index.md (checkChildDefaults) and never reach a page.
//
// What a page took is merged into its reading (values and maps), so everything that reads a page's frontmatter
// reads its defaults too, and recorded in its `defaults`, by key ("tags", "related.limit"), with the index.md and
// line it came from: a problem about a defaulted value names that file and line (placeOf, at the call sites).

import { CHILD_DEFAULTS, type FrontmatterMap, type FrontmatterValue } from "../frontmatter.js";
import type { PageFile } from "./pages.js";

/** Keys a folder can't set for its pages: one page's own (`title`, `order`, `redirectFrom`, `date`, `updated`), a
 *  folder index's own (`sort`, `view`, `childLayout`, `childDefaults`), and what the storefront fills itself. */
export const NOT_DEFAULTABLE = ["title", "order", "redirectFrom", "date", "updated", "sort", "view", "childLayout", CHILD_DEFAULTS,
  "body", "site", "page"] as const;
const notDefaultable = new Set<string>(NOT_DEFAULTABLE);

/** Where a defaulted value came from: the index.md (relative to the pages folder) and the line it is set on. */
export interface DefaultOrigin { from: string; line: number | undefined }

/** The folders above a route, nearest first: for /a/b/c/ (a page, or the index.md of folder c) /a/b/, /a/, /. */
export function foldersAbove(route: string): string[] {
  const segments = route.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = segments.length - 1; i >= 0; i--) out.push(i === 0 ? "/" : `/${segments.slice(0, i).join("/")}/`);
  return out;
}

/** Merge into each page what the folders above it set for it, and record where each value came from. */
export function applyFolderDefaults(files: ReadonlyMap<string, PageFile>): void {
  for (const f of files.values()) {
    const { values, maps, lines } = f.frontmatter;
    const origins: Record<string, DefaultOrigin> = {};
    for (const folder of foldersAbove(f.route)) {
      const index = files.get(folder);
      const block = index?.frontmatter.childDefaults;
      if (!index || !block) continue;
      const lineOf = (key: string): number | undefined => index.frontmatter.lines[`${CHILD_DEFAULTS}.${key}`];
      for (const [key, value] of Object.entries(block.values)) {
        if (key === "layout" || notDefaultable.has(key)) continue;
        if (key in values || key in maps) continue; // the page's own, or a nearer folder's
        values[key] = cloneValue(value);
        origins[key] = { from: index.path, line: lineOf(key) };
      }
      for (const [key, options] of Object.entries(block.maps)) {
        if (notDefaultable.has(key)) continue;
        if (key in values) continue; // the page set it as a plain value: its own, and checked as such
        const map: FrontmatterMap = maps[key] ?? (maps[key] = {});
        if (!(key in origins) && lines[key] === undefined) origins[key] = { from: index.path, line: lineOf(key) };
        for (const [option, value] of Object.entries(options)) {
          if (option in map) continue;
          map[option] = cloneValue(value);
          origins[`${key}.${option}`] = { from: index.path, line: lineOf(`${key}.${option}`) };
        }
      }
    }
    if (Object.keys(origins).length) f.defaults = origins;
  }
}

const cloneValue = (v: FrontmatterValue): FrontmatterValue => Array.isArray(v) ? [...v] : v;

/** Where a page's value for `key` came from, when a folder set it: the key itself, else its map's ("related.limit"
 *  falls back to "related" when the whole map came from a folder). Undefined for the page's own values. */
/** " (from the childDefaults of services/index.md, line 9)": how a problem names where a defaulted value came from. */
export const defaultsNote = (o: DefaultOrigin): string =>
  ` (from the ${CHILD_DEFAULTS} of ${o.from}${o.line !== undefined ? `, line ${o.line}` : ""})`;

/** What placeOf and originOf read of a page. */
export type PagePlace = Pick<PageFile, "path" | "frontmatter" | "defaults">;

export function originOf(page: PagePlace, key: string): DefaultOrigin | undefined {
  const d = page.defaults;
  if (!d) return undefined;
  if (d[key]) return d[key];
  const dot = key.indexOf(".");
  return dot > 0 && page.frontmatter.lines[key] === undefined ? d[key.slice(0, dot)] : undefined;
}

/** Where a page's key is, as a problem names it: "services/web.md:7" for its own value, and for one a folder set,
 *  the page with that folder's index.md and line: "services/web.md (from the childDefaults of services/index.md,
 *  line 9)". */
export function placeOf(page: PagePlace, key: string): string {
  const o = originOf(page, key);
  if (o) return `${page.path}${defaultsNote(o)}`;
  const line = page.frontmatter.lines[key];
  return `${page.path}${line !== undefined ? `:${line}` : ""}`;
}

/**
 * The problems of an index.md's `childDefaults` block on its own: keys that can't be defaulted, and `layout` beside
 * `childLayout`. Each at its line. The values themselves are checked on every page that takes them, against that
 * page's layout.
 */
export function checkChildDefaults(index: PageFile): { line: number | undefined; message: string }[] {
  const block = index.frontmatter.childDefaults;
  if (!block) return [];
  const lineOf = (key: string): number | undefined => index.frontmatter.lines[`${CHILD_DEFAULTS}.${key}`];
  const out: { line: number | undefined; message: string }[] = [];
  for (const key of [...Object.keys(block.values), ...Object.keys(block.maps)]) {
    if (!notDefaultable.has(key)) continue;
    out.push({ line: lineOf(key), message: `${CHILD_DEFAULTS}.${key}: "${key}" can't be set for a folder's pages`
      + ` (${key === "childLayout" || key === CHILD_DEFAULTS ? "it belongs on a folder's own index.md" : "it is one page's own"}): set it on each page` });
  }
  if ("layout" in block.values && index.frontmatter.values["childLayout"] !== undefined) {
    out.push({ line: lineOf("layout"), message: `${CHILD_DEFAULTS}.layout and childLayout both set the layout of this folder's pages: keep one` });
  }
  return out;
}
