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
import { PD_ROUTES, type StorefrontNavItem, type StorefrontPage, type StorefrontPagesResponse } from "@pattern-dump/contracts";
import { readFrontmatterStrict, type FrontmatterReading } from "../frontmatter.js";
import { orderSiblings, parseOrder, type Orderable } from "../tree-order.js";
import { redirectProblems, redirectsOf, workbenchPlace } from "./redirects.js";

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
}

export interface PageModel extends StorefrontPagesResponse {
  /** Every page by route, in the order of `pages`. */
  files: Map<string, PageFile>;
  /** 404.md at the top of the pages folder, at the route /404.html: not a page of the site, so in neither
   *  `pages`, `files` nor the nav. Absent when the site has none (a built-in one is used). */
  notFound?: PageFile;
  /** Problems with the folder as a whole, one line each. Empty when it is a sound site. */
  problems: string[];
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
export async function readPages(pagesDir: string, opts: { workbenchPath?: string | undefined } = {}): Promise<PageModel> {
  const problems: string[] = [];
  const files = new Map<string, PageFile>();
  let notFound: PageFile | undefined;
  if (!await stat(pagesDir).then(s => s.isDirectory(), () => false)) {
    return { pages: [], nav: [], files, problems: [`the pages folder ${pagesDir} does not exist`] };
  }
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
  }

  const pageOf = (f: PageFile): StorefrontPage => {
    const redirectFrom = redirectsOf(f);
    return {
      route: f.route,
      title: scalar(f.frontmatter.values["title"]) ?? f.route,
      layout: scalar(f.frontmatter.values["layout"]) ?? DEFAULT_LAYOUT,
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
    if (!files.has(folder)) problems.push(`the folder ${folder.slice(1)} holds pages but has no index.md — it needs one, as the folder's own page`);
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
  return { pages, nav, files: new Map(routes.map(r => [r, files.get(r)!])), problems, ...(notFound ? { notFound } : {}) };
}
