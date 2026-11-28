// What the site's output holds: every file and folder Pattern Dump writes into it, as one list of claims, and the
// check that another file (a feed's address, a file another tool built) takes none of their places.
//
//   a page, a tag or category page   /guide/            -> the file /guide/index.html
//   a forward from an old route      /old-name/         -> the file /old-name/index.html
//                                    /old-name.html     -> that file
//   a feed                           /articles/feed.xml -> that file
//   an image beside the pages        guide/shot.png     -> the file /guide/shot.png
//   the root files                   /sitemap.xml, /robots.txt, /llms.txt, /404.html, /.nojekyll
//   the folders PD writes            /_pd/ (styles, scripts, images, symbols, social cards, the search index),
//                                    /assets/, /preview/, and /_pagefind/, which is kept free for search
//
// Paths are the site's, from its root, without the base path: the file a static host serves for a URL.

import { PD_ROUTE_PREFIX, PD_ROUTES } from "@pattern-dump/contracts";
import type { PageModel } from "./pages.js";
import { isFileRoute } from "./redirects.js";

/** One place in the site's output that Pattern Dump writes. A file's `path` is the file's (/guide/index.html); a
 *  folder's ends with "/" and covers everything under it. A page or a forward also has its `route`, a feed its
 *  `source` (the config or the index.md that asks for it), a mounted file (mounts.ts) its folder and path in it. */
export type Claim =
  | { kind: "page" | "forward"; path: string; route: string }
  | { kind: "feed" | "mount"; path: string; source: string }
  | { kind: "image" | "file"; path: string }
  | { kind: "folder"; path: string }
  // For a mounted file (forMounts): a project asset served at `path`, from `file` (as shown, from the project's root);
  // and the assets folder's own name, which a file can't have.
  | { kind: "asset"; path: string; file: string }
  | { kind: "asset-folder"; path: string };

/** The files every site may have at its root, whether this build writes them or not. */
const ROOT_FILES = [PD_ROUTES.sitemap, PD_ROUTES.robots, "/llms.txt", PD_ROUTES.notFound, "/.nojekyll"];
/** The folders Pattern Dump writes into, whole. */
const FOLDERS = ["/_pd/", "/assets/", "/preview/", "/_pagefind/"];

/** The file a route is written to: /guide/ -> /guide/index.html, / -> /index.html; an old route that is a file
 *  (/old.html, redirects.ts) is written at that path. */
const fileOf = (route: string): string => isFileRoute(route) ? route
  : `/${route.replace(/^\/+|\/+$/g, "")}/index.html`.replace(/^\/\//, "/");

/**
 * Every place Pattern Dump writes into the site's output for this page model: the root files, its folders, each
 * page and each forward from an old route, each image beside the pages, and each feed in `feeds`. In that order, so
 * a path two of them hold is named by the first.
 */
export function claimsOf(model: Pick<PageModel, "pages" | "images">, feeds: readonly { address: string; source?: string }[] = []): Claim[] {
  return [
    ...ROOT_FILES.map((path): Claim => ({ kind: "file", path })),
    ...FOLDERS.map((path): Claim => ({ kind: "folder", path })),
    ...model.pages.map((p): Claim => ({ kind: "page", path: fileOf(p.route), route: p.route })),
    ...model.pages.flatMap(p => (p.redirectFrom ?? []).map((route): Claim => ({ kind: "forward", path: fileOf(route), route }))),
    ...model.images.map((rel): Claim => ({ kind: "image", path: `/${rel}` })),
    ...feeds.map((f): Claim => ({ kind: "feed", path: f.address, source: f.source ?? f.address })),
  ];
}

/**
 * The claim a file at `path` (a site path, such as /guide/shot.png) would take the place of, or undefined. A file
 * collides with a claimed file at the same path, with anything under a claimed folder, and where a file and a folder
 * would share a name: a file /guide against the page's /guide/index.html, a file /sitemap.xml/x against /sitemap.xml.
 */
export function collisionOf(claims: readonly Claim[], path: string): Claim | undefined {
  return claims.find(c => c.kind === "folder"
    ? path.startsWith(c.path) || c.path === `${path}/`
    : c.kind === "asset-folder" ? c.path === `${path}/`
      : c.path === path || c.path.startsWith(`${path}/`) || path.startsWith(`${c.path}/`));
}

/**
 * The claims a mounted file is checked against: `claims` (claimsOf), with /assets/ claimed file by file instead of
 * whole. A mount may publish under /assets/ where no project asset is served (FEAT-SITE-MOUNTS decision 3: only a
 * file PD writes can't be overwritten); `assets` are the project assets served at the mounted files' paths, each
 * found with the lookup pd dev's /assets/ route uses (asset-file.ts). The name /assets itself stays PD's.
 */
export function forMounts(claims: readonly Claim[], assets: readonly { path: string; file: string }[]): Claim[] {
  return [
    ...claims.filter(c => !(c.kind === "folder" && c.path === PD_ROUTE_PREFIX.assets)),
    { kind: "asset-folder", path: PD_ROUTE_PREFIX.assets },
    ...assets.map((a): Claim => ({ kind: "asset", path: a.path, file: a.file })),
  ];
}

/** What a claim is, in a message: "the page /guide/", "the site's sitemap.xml", "in _pd/, which Pattern Dump writes". */
export function describeClaim(c: Claim): string {
  switch (c.kind) {
    case "page": case "forward": return `the page ${c.route}`;
    case "feed": return `${c.source}'s feed`;
    case "mount": return `${c.source}, a mounted file`;
    case "image": return `the image ${c.path}`;
    case "file": return `the site's ${c.path.slice(1)}`;
    case "folder": case "asset-folder": return `in ${c.path.slice(1, -1)}/, which Pattern Dump writes`;
    case "asset": return `the project asset ${c.file}`;
  }
}

/** Whether a file at `path` is one Pattern Dump claims: a claimed file, or a file under a claimed folder. */
export const isClaimed = (claims: readonly Claim[], path: string): boolean =>
  claims.some(c => c.kind === "folder" ? path.startsWith(c.path) : c.kind !== "asset-folder" && c.path === path);

/** The files of `paths` (site paths) that no claim covers, in order. The build writes only claimed files: one that
 *  isn't is a kind of output missing from claimsOf, so another tool's file could take its place unnoticed. */
export const unclaimed = (claims: readonly Claim[], paths: Iterable<string>): string[] =>
  [...new Set(paths)].filter(p => !isClaimed(claims, p));
