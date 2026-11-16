// Search (step 5): pd build indexes the site with Pagefind and writes the index into the site, at /_pd/search/. No
// server: the skin's search component loads /_pd/search/pagefind.js (under the site's path, which
// <meta name="pd-base-path"> names) and searches in the browser.
//
//   - What is indexed is each page's own content, which Pattern Dump knows: its rendered body (markdown and the
//     components it places), with its title. Never the layout's markup: header, footer, navigation, listings and
//     related pages (other pages' titles and teasers) and the copy buttons (added by script) are never in the index.
//     The written pages carry no Pagefind attributes; each page is given to Pagefind as a document of its own.
//   - Left out: the 404 page (no address of its own), tag and category pages and their indexes (other pages' labels
//     and teasers; the filters do their job), redirect stubs, and a page with `index: false`. Drafts and scheduled
//     pages are never built.
//   - Filters: section (the label of the page's collection), tag and category (their labels). Meta: title, teaser.
//   - storefront.search: true asks for it (no Pagefind stops the build); false turns it off; left out, it is on when
//     the project has Pagefind. Pagefind is the project's own (`npm install --save-dev pagefind`), as Playwright is
//     for --browser: Pattern Dump does not depend on it.
//   - pd dev builds no index (a save stays as fast as it is): search works on the built site.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { escapeAttr, escapeHtml } from "../http-utils.js";

/** Where the index is written, under the site's path. */
export const SEARCH_PATH = "/_pd/search/";

/** What a page gives the index. */
export interface SearchRecord {
  route: string;
  title: string;
  /** The page's rendered body, without the layout. */
  body: string;
  /** The label of the page's collection (the folder that lists it), or null for a page at the top. */
  section: string | null;
  tags: string[];
  categories: string[];
  /** Its listing teaser: its description, else its first paragraph. */
  teaser: string | null;
  lang: string;
}

/** The part of Pagefind this uses. */
export interface PagefindModule {
  createIndex(config?: Record<string, unknown>): Promise<{ errors: string[]; index?: PagefindIndex }>;
  close(): Promise<unknown>;
}
interface PagefindIndex {
  addHTMLFile(file: { url: string; content: string }): Promise<{ errors: string[] }>;
  getFiles(): Promise<{ errors: string[]; files: Array<{ path: string; content: Uint8Array }> }>;
}

/** Search is asked for and Pagefind couldn't be loaded: what to install. */
export class SearchUnavailableError extends Error {}

export const PAGEFIND_INSTALL = "npm install --save-dev pagefind";

/**
 * The entry of the project's Pagefind: its package in node_modules, from the project's root up (Pagefind exports
 * only an `import` condition, so require.resolve can't find it); undefined when it has none.
 */
export function projectPagefindEntry(root: string): string | undefined {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const pkg = join(dir, "node_modules", "pagefind", "package.json");
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, "utf8")) as { main?: string; exports?: { ".": { import?: string } } };
      return join(dirname(pkg), json.exports?.["."]?.import ?? json.main ?? "lib/index.js");
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** The project's Pagefind; undefined when it has none. */
export async function loadProjectPagefind(root: string): Promise<PagefindModule | undefined> {
  const entry = projectPagefindEntry(root);
  if (entry === undefined) return undefined;
  const mod = await import(pathToFileURL(entry).href) as Partial<PagefindModule>;
  return typeof mod.createIndex === "function" && typeof mod.close === "function" ? mod as PagefindModule : undefined;
}

/** The Pagefind to index with, by storefront.search: undefined when there is no search; a stop when it is asked for
 *  and the project has none. */
export async function searchPagefind(setting: boolean | undefined, root: string,
  load: (root: string) => Promise<PagefindModule | undefined> = loadProjectPagefind): Promise<PagefindModule | undefined> {
  if (setting === false) return undefined;
  const pagefind = await load(root);
  if (!pagefind && setting === true) {
    throw new SearchUnavailableError(`pd build: storefront.search is on, and this project has no Pagefind to build the index with: ${PAGEFIND_INSTALL} `
      + `(or set storefront.search to false)`);
  }
  return pagefind;
}

/** The document Pagefind is given for a page: its title, its filters and meta outside the indexed part, and its body,
 *  with the title as its <h1> when the body has none. */
export function searchDocument(r: SearchRecord): string {
  const filter = (name: string, values: readonly string[]) => values.map(v => `<span data-pagefind-filter="${name}">${escapeHtml(v)}</span>`).join("");
  const meta = (name: string, value: string | null) => value === null ? "" : `<span data-pagefind-meta="${name}">${escapeHtml(value)}</span>`;
  const h1 = /<h1[\s>]/i.test(r.body) ? "" : `<h1>${escapeHtml(r.title)}</h1>\n`;
  return `<!DOCTYPE html>\n<html lang="${escapeAttr(r.lang)}"><head><title>${escapeHtml(r.title)}</title></head><body>\n`
    + `${meta("title", r.title)}${meta("teaser", r.teaser)}${filter("section", r.section === null ? [] : [r.section])}`
    + `${filter("tag", r.tags)}${filter("category", r.categories)}\n`
    + `<main data-pagefind-body>\n${h1}${r.body}\n</main>\n</body></html>`;
}

/** Pagefind's own UIs: the skin has its own, so they are not written. */
const UI_FILE = /^pagefind-(?:ui|modular-ui|component-ui|highlight)\.(?:js|css)$/;

/**
 * The index of `records`, as files by their path under SEARCH_PATH. `basePath`: the path the site is published under,
 * in front of each result's URL. Sorted by path, so a build writes them in one order.
 */
export async function buildSearchIndex(records: readonly SearchRecord[], pagefind: PagefindModule, basePath: string): Promise<Map<string, Uint8Array>> {
  try {
    return await indexWith(records, pagefind, basePath);
  } finally {
    await pagefind.close();
  }
}

async function indexWith(records: readonly SearchRecord[], pagefind: PagefindModule, basePath: string): Promise<Map<string, Uint8Array>> {
  const created = await pagefind.createIndex({});
  if (!created.index) throw new Error(`pd build: Pagefind couldn't start: ${created.errors.join("; ")}`);
  const index = created.index;
  const errors: string[] = [];
  for (const r of [...records].sort((a, b) => a.route < b.route ? -1 : a.route > b.route ? 1 : 0)) {
    const added = await index.addHTMLFile({ url: `${basePath}${r.route.slice(1)}`, content: searchDocument(r) });
    errors.push(...added.errors.map(e => `${r.route}: ${e}`));
  }
  const got = await index.getFiles();
  errors.push(...got.errors);
  if (errors.length) throw new Error(`pd build: Pagefind couldn't index the site:\n${errors.map(e => `  - ${e}`).join("\n")}`);
  const files = new Map<string, Uint8Array>();
  for (const f of [...got.files].sort((a, b) => a.path < b.path ? -1 : 1)) if (!UI_FILE.test(f.path)) files.set(f.path, f.content);
  return files;
}
