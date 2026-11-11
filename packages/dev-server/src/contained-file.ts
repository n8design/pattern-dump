// The one check every route that maps part of a URL to a file goes through: the file must be inside the
// folder the route serves from, as the file system resolves both (symlinks followed), or the route has no
// file for it. A request the check refuses is answered like any missing file.

import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Whether `path` is `root` itself or lies inside it (both absolute and resolved). */
export function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * The file `rest` names inside `root`, or null: when `rest` holds a NUL or a backslash (never part of a URL
 * path PD makes; a backslash is a separator on Windows), when the file, as the file system resolves it with
 * every link followed, is not inside `root` as the file system resolves it, or when there is no such file.
 * Comparing the resolved paths covers ".." and a link pointing out alike. `rest` is already decoded.
 */
export async function containedFile(root: string, rest: string): Promise<string | null> {
  if (rest.includes("\0") || rest.includes("\\")) return null;
  const base = resolve(root);
  const candidate = resolve(base, rest.replace(/^\/+/, ""));
  let real: string, realRoot: string;
  try {
    [real, realRoot] = await Promise.all([realpath(candidate), realpath(base)]);
  } catch {
    return null; // no such file (or root)
  }
  if (!isInside(real, realRoot)) return null;
  return (await stat(real)).isFile() ? real : null;
}

/** decodeURIComponent, or null for a malformed escape (which names no file). */
export function decodePath(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return null; }
}
