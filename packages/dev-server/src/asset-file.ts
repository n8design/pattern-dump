// Where a /assets/… URL is served from: the one lookup, shared by the asset route and by every check that
// must find the file a URL names (a page's image).

import { join } from "node:path";
import { PD_ROUTE_PREFIX } from "@pattern-dump/contracts";

/**
 * The file for `pathname` (a /assets/… URL path): with several roots, /assets/<root's folder name>/<rest>
 * serves from that root; any other path is looked up in the first root (the single-root mirror). Null for a
 * path outside /assets/ or a project with no asset roots. The file may not exist.
 */
export function assetFileFor(pathname: string, roots: readonly string[], names: readonly string[]): string | null {
  if (!pathname.startsWith(PD_ROUTE_PREFIX.assets) || roots.length === 0) return null;
  const tail = decodeURIComponent(pathname.slice(PD_ROUTE_PREFIX.assets.length));
  const firstSeg = tail.split("/")[0]!;
  const namedIdx = names.indexOf(firstSeg);
  return namedIdx >= 0 ? join(roots[namedIdx]!, tail.slice(firstSeg.length + 1)) : join(roots[0]!, tail);
}
