// Where a /assets/… URL is served from: the one lookup, shared by the asset route and by every check that
// must find the file a URL names (a page's image).

import { PD_ROUTE_PREFIX } from "@pattern-dump/contracts";
import { containedFile, decodePath } from "./contained-file.js";

/**
 * The file for `pathname` (a /assets/… URL path, as the URL has it, still encoded): with several roots,
 * /assets/<root's folder name>/<rest> serves from that root; any other path is looked up in the first root
 * (the single-root mirror). Null for a path outside /assets/, a project with no asset roots, or a file that
 * does not exist inside its root (contained-file.ts).
 */
export async function assetFile(pathname: string, roots: readonly string[], names: readonly string[]): Promise<string | null> {
  if (!pathname.startsWith(PD_ROUTE_PREFIX.assets) || roots.length === 0) return null;
  const tail = decodePath(pathname.slice(PD_ROUTE_PREFIX.assets.length));
  if (tail === null) return null;
  const firstSeg = tail.split("/")[0]!;
  const namedIdx = names.indexOf(firstSeg);
  return namedIdx >= 0 ? containedFile(roots[namedIdx]!, tail.slice(firstSeg.length + 1)) : containedFile(roots[0]!, tail);
}
