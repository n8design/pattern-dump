// The storefront's pages: every markdown file in `storefront.pagesDir`, at the route its path names, and
// the nav built from the folders and `order`.
//
//   pages/index.md          -> /
//   pages/about.md          -> /about/
//   pages/guides/index.md   -> /guides/
//   pages/guides/setup.md   -> /guides/setup/
//
// Order follows the component tree's rules exactly (tree-order.ts), read from the pages' frontmatter:
// a page's own `order: <number>` ranks it among its siblings; a folder's `index.md` ranks the folder with
// a number, or orders the folder's pages with a list. The root `index.md` is both the Home page — a
// top-level item, ranked by its number — and the root folder's index, whose list orders the top level.
//
// The nav is one level deep: the top-level pages and folders, and each folder's pages beneath it. Pages
// further down still exist, at their routes; they are just not in the nav.
//
// What cannot be a sound site is reported in `problems`, not guessed around, and every problem is fatal
// to the caller (D7): a folder of pages with no `index.md` (its nav entry would have no page to link to);
// two files that claim the same route; a file or folder whose name is not lowercase letters, digits and
// hyphens (the name is the URL); a file that is not a page; a pages folder that does not exist; and a
// folder with no `index.md` at its top, so no home page (an empty folder included). Dotfiles and
// dot-folders are ignored.
// Images and other files for pages belong in the project's assets, not here. Pages are read with the strict
// frontmatter reader; its errors are left to the caller, which validates every page.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { PD_ROUTES, type LayoutPageUse, type StorefrontNavItem, type StorefrontPage, type StorefrontPagesResponse } from "@pattern-dump/contracts";
import { frontmatterBody, readFrontmatterStrict, type FrontmatterReading } from "../frontmatter.js";
import { orderSiblings, parseOrder, type Orderable } from "../tree-order.js";
import { redirectProblems, redirectsOf, workbenchPlace } from "./redirects.js";
import { readChildLayout, readDate, readDraft, readSort, readTerms, readUpdated, type SortBy } from "./listing-keys.js";
import { termIndex, termOf, type Category, type CategoryIndex, type Term, type TermIndex } from "./categories.js";
import type { StorefrontCategory, StorefrontTermPages } from "@pattern-dump/config";
import { termPages, type GeneratedPage } from "./terms.js";
import { teaserOf } from "./teaser.js";

/** The layout a page uses when its frontmatter names none. */
export const DEFAULT_LAYOUT = "page";

/** The site's own "not found" page, when it has one: written to /404.html, not a page of the site. */
export const NOT_FOUND_FILE = "404.md";

export interface PageFile {
  route: string;
  /** Absolute path of the markdown file. */
  file: string;
  /** The file, relative to pagesDir, with forward slashes ("guides/setup.md"). */
  path: string;
  frontmatter: FrontmatterReading;
  /** The layout the page takes when it names none: the `childLayout` of the nearest folder above it that sets one
   *  (`from`: that folder's index.md). Absent when no folder above it does. */
  inherited?: InheritedLayout;
}

/** A default layout from a folder: the name its index.md's `childLayout` gives, and that index.md's path. */
export interface InheritedLayout { layout: string; from: string }

/** What a listing shows of a page, from its file alone (collections.ts adds the date from git). */
export interface PageEntryFields {
  /** Its description, else the first paragraph of its body (teaser.ts), else null. */
  description: string | null;
  /** Its frontmatter date, YYYY-MM-DD, or null. */
  date: string | null;
  /** Its frontmatter updated, YYYY-MM-DD, or null. */
  updated: string | null;
  /** Its image, a path in the assets, or null. */
  image: string | null;
  /** Its tags, resolved (an old key as the tag it is now). */
  tags: Term[];
  /** Its categories, resolved (an old key as the category it is now). */
  categories: Category[];
  draft: boolean;
  /** Its own date is after today (pd dev only: pd build leaves it out). A draft is never scheduled. */
  scheduled: boolean;
}

/** A page held back until a later day: its path in the pages folder, and the first day it is built (YYYY-MM-DD). */
export interface ScheduledPage { path: string; until: string }

/** The UTC date of `clock`, YYYY-MM-DD: the day a page's `date` is compared with, the same on every machine. */
export const todayOf = (clock: Date): string => clock.toISOString().slice(0, 10);

/** A folder's listing: its pages and subfolders (each by its index.md), in the folder's order, and how to sort them. */
export interface FolderListing {
  sort: SortBy;
  /** Routes, in the folder's order (the nav's rule, at any depth). */
  children: string[];
}

export interface PageModel extends StorefrontPagesResponse {
  /** Every page by route, in the order of `pages`. */
  files: Map<string, PageFile>;
  /** What a listing shows of each page, by route. A value that fails its check is left out here (null, [] or
   *  false); the page's own check reports it. */
  entries: Map<string, PageEntryFields>;
  /** Each folder's listing, by the folder's route ("/" for the top). */
  folders: Map<string, FolderListing>;
  /** Drafts, by their path in the pages folder: shown ones with `drafts: "show"`; with "leave-out", every page left
   *  out (a draft, and each page under a folder whose index.md is one). */
  drafts: string[];
  /** Pages whose date is after today, by path: shown ones (their own date only) with `scheduled: "show"`; with
   *  "leave-out", every page held back (a scheduled page, and each page under a folder whose index.md is one, until
   *  the later of the dates). Drafts are never in it. */
  scheduled: ScheduledPage[];
  /** 404.md at the top of the pages folder, at the route /404.html: not a page of the site, so in neither
   *  `pages`, `files` nor the nav. Absent when the site has none (a built-in one is used). */
  notFound?: PageFile;
  /** The declared categories (storefront.categories), which pages' `categories:` are checked against. */
  categories: CategoryIndex;
  /** The declared tags (storefront.tags), which pages' `tags:` are checked against when there are any. */
  tags: TermIndex;
  /** The tag and category pages (terms.ts), by route: in `pages` too, never in `files`, the nav or a listing. */
  generated: Map<string, GeneratedPage>;
  /** Problems with the folder as a whole, one line each. Empty when it is a sound site. */
  problems: string[];
}

/** The pages that render with the layout `name`, by path, each with where it got it (the workbench's Relationships). */
export function layoutPages(model: PageModel, name: string): LayoutPageUse[] {
  // A generated tag or category page has no file: not listed yet (contracts' LayoutPageUse has no source for it).
  return model.pages.filter(p => p.layout === name && model.files.has(p.route)).map(p => {
    const f = model.files.get(p.route)!;
    const source = p.layoutFrom !== undefined ? "folder" : f.frontmatter.values["layout"] !== undefined ? "own" : "default";
    return { route: p.route, path: f.path, source, ...(p.layoutFrom !== undefined ? { from: p.layoutFrom } : {}) } satisfies LayoutPageUse;
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** "guides/setup.md" -> "/guides/setup/", "index.md" -> "/", "guides/index.md" -> "/guides/". */
export function routeFor(path: string): string {
  const parts = path.replace(/\.md$/, "").split("/");
  if (parts.at(-1) === "index") parts.pop();
  return parts.length ? `/${parts.join("/")}/` : "/";
}

/** A page file's stem or a folder's name: it is part of the URL. */
const NAME = /^[a-z0-9-]+$/;

/** Every page file under `dir`, relative to `root` with forward slashes. Names that cannot be part of a
 *  URL, and files that are not pages, go to `problems`; a folder with such a name is not read. */
async function markdownFiles(dir: string, root: string, problems: string[]): Promise<string[]> {
  const out: string[] = [];
  const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    const rel = relative(root, p).split(sep).join("/");
    if (e.isDirectory()) {
      if (!NAME.test(e.name)) { problems.push(`${rel}/: a folder name is part of the URL, so it is lowercase letters, digits and hyphens only`); continue; }
      out.push(...await markdownFiles(p, root, problems));
    } else if (!e.name.endsWith(".md")) {
      problems.push(`${rel} is not a page: only .md files belong in the pages folder (images and other files go in the project's assets)`);
    } else if (!NAME.test(e.name.slice(0, -".md".length))) {
      problems.push(`${rel}: a page's file name is part of the URL, so it is lowercase letters, digits and hyphens only, then .md`);
    } else {
      out.push(rel);
    }
  }
  return out;
}

const scalar = (v: string | string[] | undefined): string | undefined => typeof v === "string" ? v : undefined;

/**
 * `workbenchPath`: the path of a workbench published on the storefront's host (sameHostWorkbenchPath), where no
 * page and no old route may be, since the published workbench would take its place.
 */
/**
 * `drafts`: "show" (pd dev, the default) keeps drafts as pages; "leave-out" (pd build) drops every page whose
 * frontmatter says `draft: true`, and every page under a folder whose index.md does, as if their files weren't there.
 */
/**
 * `scheduled`: "show" (pd dev, the default) keeps a page whose own `date` is after `today` (default: the clock's UTC
 * date, todayOf); "leave-out" (pd build) drops it, and every page under a folder whose index.md is one, as drafts are.
 * `categories`: storefront.categories from the config.
 */
export async function readPages(pagesDir: string, opts: {
  workbenchPath?: string | undefined; drafts?: "show" | "leave-out"; scheduled?: "show" | "leave-out"; today?: string | undefined;
  categories?: Readonly<Record<string, StorefrontCategory>> | undefined;
  tags?: Readonly<Record<string, StorefrontCategory>> | undefined;
  tagPages?: boolean | StorefrontTermPages | undefined; categoryPages?: boolean | StorefrontTermPages | undefined;
  /** The skin's layouts, by name: tag and category pages are generated only when it is given (terms.ts). */
  layouts?: ReadonlySet<string> | undefined;
} = {}): Promise<PageModel> {
  const problems: string[] = [];
  // Fresh per reading: the generated pages set the terms' routes on them.
  const categories = termIndex("category", opts.categories);
  const tags = termIndex("tag", opts.tags);
  const generated = new Map<string, GeneratedPage>();
  const files = new Map<string, PageFile>();
  let notFound: PageFile | undefined;
  if (!await stat(pagesDir).then(s => s.isDirectory(), () => false)) {
    return { pages: [], nav: [], files, entries: new Map(), folders: new Map(), drafts: [], scheduled: [], categories, tags, generated, problems: [`the pages folder ${pagesDir} does not exist`] };
  }
  const bodies = new Map<string, string>();
  for (const path of (await markdownFiles(pagesDir, pagesDir, problems)).sort()) {
    const route = routeFor(path);
    const other = files.get(route);
    if (other) { problems.push(`${other.path} and ${path} are both the page at ${route}`); continue; }
    const file = join(pagesDir, ...path.split("/"));
    // Listed, but deleted before it could be read: no longer a page.
    const text = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (text === null) continue;
    if (path === NOT_FOUND_FILE) { notFound = { route: PD_ROUTES.notFound, file, path, frontmatter: readFrontmatterStrict(text) }; continue; }
    files.set(route, { route, file, path, frontmatter: readFrontmatterStrict(text) });
    bodies.set(route, text);
  }

  // Drafts: shown, or left out with every page under a draft folder's index.md (the top's index.md is only itself).
  const isDraft = (f: PageFile | undefined): boolean => {
    const v = f?.frontmatter.values["draft"];
    return v !== undefined && (() => { const r = readDraft(v); return r.ok && r.value; })();
  };
  const drafts: string[] = [];
  for (const [route, f] of [...files]) {
    const segments = route.split("/").filter(Boolean);
    const folderDraft = segments.slice(0, -1).some((_, i) => isDraft(files.get(`/${segments.slice(0, i + 1).join("/")}/`)));
    if (!isDraft(f) && !(opts.drafts === "leave-out" && folderDraft)) continue;
    drafts.push(f.path);
    if (opts.drafts === "leave-out") { files.delete(route); bodies.delete(route); }
  }
  drafts.sort();

  // Scheduled: a page whose own date is after today, held back (in leave-out) with every page under a scheduled
  // folder's index.md, until the latest of those dates. What is left of the drafts is checked; a draft is only a draft.
  const today = opts.today ?? todayOf(new Date());
  const dateOf = (f: PageFile | undefined): string | undefined => {
    const v = f?.frontmatter.values["date"];
    if (v === undefined) return undefined;
    const r = readDate(v);
    return r.ok ? r.value : undefined;
  };
  const future = (f: PageFile | undefined): string | undefined => { const d = dateOf(f); return d !== undefined && d > today ? d : undefined; };
  const scheduled: ScheduledPage[] = [];
  const ownScheduled = new Set<string>();
  for (const [route, f] of [...files]) {
    if (isDraft(f)) continue;
    const own = future(f);
    if (own !== undefined) ownScheduled.add(route);
    const segments = route.split("/").filter(Boolean);
    const folders = opts.scheduled === "leave-out"
      ? segments.slice(0, -1).map((_, i) => future(files.get(`/${segments.slice(0, i + 1).join("/")}/`))).filter((d): d is string => d !== undefined)
      : [];
    const until = [own, ...folders].filter((d): d is string => d !== undefined).sort().at(-1);
    if (until === undefined) continue;
    scheduled.push({ path: f.path, until });
  }
  if (opts.scheduled === "leave-out") {
    for (const s of scheduled) { const route = routeFor(s.path); files.delete(route); bodies.delete(route); }
  }
  scheduled.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

  // Default layouts: each page that names no layout takes the childLayout of the nearest folder above it that sets
  // one. A folder's index.md is a page of its parent folder, so its own childLayout is for the pages under it.
  const childLayoutOf = (folder: string): string | undefined => {
    const index = files.get(folder);
    const v = index?.frontmatter.values["childLayout"];
    if (!index || v === undefined) return undefined;
    const r = readChildLayout(v, index.path);
    return r.ok ? r.value : undefined;
  };
  for (const f of files.values()) {
    const segments = f.route.split("/").filter(Boolean);
    // The folders above the page, nearest first: for /a/b/c/ (a page, or the index.md of folder c) they are /a/b/, /a/, /.
    for (let i = segments.length - 1; i >= 0; i--) {
      const folder = i === 0 ? "/" : `/${segments.slice(0, i).join("/")}/`;
      const layout = childLayoutOf(folder);
      if (layout !== undefined) { f.inherited = { layout, from: files.get(folder)!.path }; break; }
    }
  }

  const pageOf = (f: PageFile): StorefrontPage => {
    const redirectFrom = redirectsOf(f);
    const own = f.frontmatter.values["layout"];
    const inherited = own === undefined ? f.inherited : undefined;
    return {
      route: f.route,
      title: scalar(f.frontmatter.values["title"]) ?? f.route,
      layout: scalar(own) ?? inherited?.layout ?? DEFAULT_LAYOUT,
      ...(inherited ? { layoutFrom: inherited.from } : {}),
      ...(redirectFrom.length ? { redirectFrom } : {}),
    };
  };
  /** A nav entry's page fields: its route and title, and its description when it has one. */
  const entryOf = (f: PageFile): StorefrontNavItem => {
    const description = scalar(f.frontmatter.values["description"]);
    return { route: f.route, title: pageOf(f).title, ...(description !== undefined ? { description } : {}) };
  };
  const weightOf = (f: PageFile | undefined): number | undefined => {
    const o = parseOrder(f?.frontmatter.values["order"]);
    return o && "weight" in o ? o.weight : undefined;
  };
  const listOf = (f: PageFile | undefined): string[] | undefined => {
    const o = parseOrder(f?.frontmatter.values["order"]);
    return o && "list" in o ? o.list : undefined;
  };

  // Folders that hold pages, by their route; each needs its own index.md.
  const folders = new Set<string>();
  for (const f of files.values()) {
    const parts = f.path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.add(`/${parts.slice(0, i).join("/")}/`);
  }
  if (!files.has("/")) problems.push("there is no home page: the pages folder needs an index.md at its top, the page at /");
  for (const folder of [...folders].sort()) {
    if (!files.has(folder)) problems.push(`the folder ${folder.slice(1)} holds pages but has no index.md: it needs one, as the folder's own page`);
  }

  /** The direct children of a folder route: its pages (not its index) and its subfolders. */
  const childrenOf = (folder: string): Array<{ route: string; segment: string }> => {
    const depth = folder === "/" ? 0 : folder.split("/").length - 2;
    const out = new Map<string, string>();
    for (const route of [...files.keys(), ...folders]) {
      if (route === folder || !route.startsWith(folder)) continue;
      const segs = route.split("/").filter(Boolean);
      if (segs.length !== depth + 1) continue;
      out.set(route, segs[depth]);
    }
    return [...out].map(([route, segment]) => ({ route, segment }));
  };

  type Item = Orderable & { route: string };
  const ordered = (folder: string, extra: Item[] = []): Item[] => {
    const items: Item[] = childrenOf(folder).map(c => {
      const w = weightOf(files.get(c.route));
      return { route: c.route, segment: c.segment, ...(w !== undefined ? { weight: w } : {}) };
    });
    return orderSiblings([...extra, ...items], listOf(files.get(folder)));
  };

  // Top level: Home (the root index, ranked by its own number) beside the top-level pages and folders.
  const home = files.get("/");
  const homeWeight = weightOf(home);
  const top = ordered("/", home ? [{ route: "/", segment: "index", ...(homeWeight !== undefined ? { weight: homeWeight } : {}) }] : []);

  const nav: StorefrontNavItem[] = [];
  for (const item of top) {
    const page = files.get(item.route);
    if (!page) continue; // a folder without index.md: reported above, no entry to link to
    const children = folders.has(item.route) && item.route !== "/"
      ? ordered(item.route).flatMap(c => {
        const p = files.get(c.route);
        return p ? [entryOf(p)] : [];
      })
      : [];
    nav.push({ ...entryOf(page), ...(children.length ? { children } : {}) });
  }

  // Every page: in nav order first, then the ones the nav does not reach, by path.
  const inNav = nav.flatMap(n => [n.route, ...(n.children ?? []).map(c => c.route)]);
  const rest = [...files.keys()].filter(r => !inNav.includes(r)).sort();
  const routes = [...inNav, ...rest];
  const pages = routes.map(r => pageOf(files.get(r)!));
  // A page where the same-host workbench is published.
  const { workbenchPath } = opts;
  if (workbenchPath !== undefined) {
    for (const f of files.values()) {
      if (f.route.startsWith(workbenchPath)) problems.push(`${f.path}: the page ${f.route} is ${workbenchPlace(f.route, workbenchPath)}`);
    }
  }
  // Redirects across pages: an old route that is a page, or that two pages claim.
  problems.push(...redirectProblems(files, workbenchPath));

  // What listings show of each page, and each folder's listing.
  const ok = <T>(v: string | string[] | undefined, read: (v: string | string[]) => { ok: true; value: T } | { ok: false }): T | undefined => {
    if (v === undefined) return undefined;
    const r = read(v);
    return r.ok ? r.value : undefined;
  };
  const entries = new Map<string, PageEntryFields>();
  const termKeys = new Map<string, { tags: string[]; categories: string[] }>();
  for (const route of routes) {
    const v = files.get(route)!.frontmatter.values;
    termKeys.set(route, {
      tags: ok(v["tags"], x => readTerms(x, tags))?.keys ?? [],
      categories: ok(v["categories"], x => readTerms(x, categories))?.keys ?? [],
    });
  }
  // The tag and category pages, from the published pages; then every term knows its route.
  const isPublished = (route: string) => !isDraft(files.get(route)) && !ownScheduled.has(route);
  const generatedPages = termPages({
    indexes: { tag: tags, category: categories }, settings: { tag: opts.tagPages, category: opts.categoryPages }, layouts: opts.layouts,
    files: new Map([...files.values()].map(f => [f.route, { path: f.path }])),
    sources: routes.filter(isPublished).map(route => {
      const v = files.get(route)!.frontmatter.values;
      const date = ok(v["date"], x => readDate(x)) ?? null;
      return { route, path: files.get(route)!.path, ...termKeys.get(route)!, date,
        updated: ok(v["updated"], x => readUpdated(x, date ?? undefined)) ?? null, redirectFrom: redirectsOf(files.get(route)!) };
    }),
  });
  problems.push(...generatedPages.problems);
  for (const g of generatedPages.pages) generated.set(g.route, g);
  const routeOf = new Map(generatedPages.pages.filter(g => g.term).map(g => [`${g.kind}:${g.term!.key}`, g.route]));
  for (const index of [tags, categories]) for (const t of index.list) t.route = routeOf.get(`${index.kind}:${t.key}`) ?? null;
  const termsOf = (index: TermIndex, keys: string[]): Term[] =>
    keys.map(k => ({ ...termOf(index, k), route: routeOf.get(`${index.kind}:${k}`) ?? null }));
  for (const route of routes) {
    const f = files.get(route)!;
    const v = f.frontmatter.values;
    const description = scalar(v["description"]);
    const image = scalar(v["image"]);
    const date = ok(v["date"], x => readDate(x)) ?? null;
    entries.set(route, {
      description: description ?? teaserOf(frontmatterBody(bodies.get(route)!)),
      date,
      updated: ok(v["updated"], x => readUpdated(x, date ?? undefined)) ?? null,
      image: image !== undefined && /^\/assets\/[^?#]+[^/?#]$/.test(image) ? image : null,
      tags: termsOf(tags, termKeys.get(route)!.tags),
      categories: termsOf(categories, termKeys.get(route)!.categories),
      draft: ok(v["draft"], readDraft) ?? false,
      scheduled: ownScheduled.has(route),
    });
  }
  const listings = new Map<string, FolderListing>();
  for (const folder of ["/", ...[...folders].sort()]) {
    const index = files.get(folder);
    if (!index) continue;
    listings.set(folder, {
      sort: ok(index.frontmatter.values["sort"], v => readSort(v, index.path)) ?? "order",
      children: ordered(folder).map(c => c.route).filter(r => files.has(r)),
    });
  }
  // The generated pages are pages of the site (crawled, in the sitemap), after the folder's.
  for (const g of generated.values()) {
    pages.push({ route: g.route, title: g.title, layout: g.layout, ...(g.redirectFrom.length ? { redirectFrom: g.redirectFrom } : {}) });
  }
  return { pages, nav, files: new Map(routes.map(r => [r, files.get(r)!])), entries, folders: listings, drafts, scheduled, categories, tags, generated,
    problems, ...(notFound ? { notFound } : {}) };
}
