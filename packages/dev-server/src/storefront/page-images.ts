// Images beside a site's pages: image files in `site.pagesDir`, next to the markdown that shows them.
//
//   pages/guide/shot.png    -> /guide/shot.png    (its variants under /_pd/images/guide/shot.<hash>.<width>.webp)
//
// A page refers to one by a relative path (`./shot.png`, `shot.png`, `../shared/diagram.svg`), resolved against the
// page's own folder; it must stay inside the pages folder. From then on it is an image like one from the assets,
// under its absolute URL, so the HTML doesn't depend on whether the route ends in a slash. A file's name is part of
// its URL, so it follows the page names' rule: lowercase letters, digits and hyphens, then the extension.
// A route has no extension, so an image can't take a page's place.

import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { PD_ROUTE_PREFIX } from "@pattern-dump/contracts";
import { containedFile, decodePath } from "../contained-file.js";

/** A page file's stem, an image's stem or a folder's name: it is part of the URL. */
export const URL_NAME = /^[a-z0-9-]+$/;

/** The image formats a pages folder may hold: the rasters the image pipeline encodes, and SVG. */
export const PAGE_IMAGE_FORMATS = "PNG, JPEG, GIF, WebP or SVG";
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg)$/i;

/** Whether a file name is an image's, whatever the case of its extension. */
export const isImageName = (name: string): boolean => IMAGE_EXT.test(name);

/** Whether a file name is a valid image name: a URL name, then a lowercase image extension. */
export const isValidImageName = (name: string): boolean => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && URL_NAME.test(name.slice(0, dot)) && /^\.(?:png|jpe?g|gif|webp|svg)$/.test(name.slice(dot));
};

/** The valid name closest to an image's file name ("Guest_Access.PNG" -> "guest-access.png"), or null when nothing
 *  of its stem is left. */
export function suggestImageName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  const stem = name.slice(0, dot).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return stem ? `${stem}${name.slice(dot).toLowerCase()}` : null;
}

/** The paths Pattern Dump serves itself on the site's host: no image in the pages folder may be there. */
export const RESERVED_PREFIXES = [PD_ROUTE_PREFIX.assets, PD_ROUTE_PREFIX.preview, "/api/", PD_ROUTE_PREFIX.source] as const;

/** The reserved prefix a URL is under, if any. */
export const reservedPrefixOf = (url: string): string | undefined => RESERVED_PREFIXES.find(p => url.startsWith(p));

/** Whether a URL path names an image beside the pages: valid names all the way down, and not a path the server
 *  answers itself (the assets, previews, the API, sources, and everything under /_pd/, whose name is no URL name). */
export function isPageImageUrl(pathname: string): boolean {
  if (reservedPrefixOf(pathname) !== undefined) return false;
  const segments = pathname.split("/");
  if (segments[0] !== "" || segments.length < 2) return false;
  return segments.slice(1, -1).every(s => URL_NAME.test(s)) && isValidImageName(segments.at(-1)!);
}

/** The file a page image's URL names inside `pagesDir`, or null: a URL that isn't one, or no such file (containment
 *  as the file system resolves it, contained-file.ts). */
export async function pageImageFile(pathname: string, pagesDir: string): Promise<string | null> {
  const decoded = decodePath(pathname);
  if (decoded === null || !isPageImageUrl(decoded)) return null;
  return containedFile(pagesDir, decoded.slice(1));
}

/** Every valid image file in `pagesDir` at the URL it is served at (`/<path>`), skipping dotfiles, dot-folders and
 *  folders whose name is no URL name, as the pages folder's reading does (pages.ts). Sorted by URL. */
export async function pageImageFiles(pagesDir: string): Promise<Array<{ url: string; path: string }>> {
  const out: Array<{ url: string; path: string }> = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) { if (URL_NAME.test(e.name)) await walk(join(dir, e.name), `${prefix}${e.name}/`); continue; }
      const url = `/${prefix}${e.name}`;
      if (e.isFile() && isPageImageUrl(url)) out.push({ url, path: join(dir, e.name) });
    }
  };
  await walk(pagesDir, "");
  return out.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
}

export type ResolvedPageImage = { ok: true; rel: string; url: string } | { ok: false; outside: true };

/** Whether an address is a relative path: not root-relative, not a fragment, no scheme. */
export const isRelativePath = (src: string): boolean => src !== "" && !/^[/#]/.test(src) && !/^[a-z][a-z0-9+.-]*:/i.test(src);

/**
 * A relative image path, resolved against the folder of `fromPath` (a page's path in the pages folder, forward
 * slashes): the image's path in the pages folder and its URL; or that it leaves the pages folder. `src` may be
 * percent-encoded, as markdown writes it.
 */
export function resolvePageImage(src: string, fromPath: string): ResolvedPageImage {
  const decoded = decodePath(src) ?? src;
  const rel = posix.normalize(posix.join(posix.dirname(fromPath), decoded));
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("/") || rel === ".") return { ok: false, outside: true };
  return { ok: true, rel, url: `/${rel}` };
}
