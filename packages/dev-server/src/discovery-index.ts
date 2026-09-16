// Read-only queries over a DiscoveryResult's indexes.
//
// A LEAF: no state, no I/O beyond path normalisation. Discovery owns identity and file paths (M6);
// these are the two questions the server asks of that index, and neither reconstructs a path —
// they look one up. No site outside discovery should be rebuilding `<id>/<name>.hbs`.

import { resolve } from "node:path";
import type { DiscoveryResult } from "@pattern-dump/contracts";

/** Component ids without variant segments — used to scope SCSS attribution. */
export function baseComponentIds(dr: DiscoveryResult): Set<string> {
  const ids = new Set<string>();
  for (const id of dr.discoveryMap.keys()) {
    if (!id.includes("~")) ids.add(id);
  }
  return ids;
}

/** Resolve a changed file to its component id using the discovery result's reverse indexes.
 *  For .hbs files: O(1) lookup via hbsPathToId.
 *  For .json files: scan discoveryMap for a matching jsonPath and return the base id
 *  (variant json → base component so HMR targets the rendering component, not the data slot). */
export function resolveComponentForFile(filePath: string, dr: DiscoveryResult): string | null {
  const absPath = resolve(filePath);

  // .hbs fast path
  const hbsId = dr.hbsPathToId.get(absPath);
  if (hbsId !== undefined) return hbsId;

  // .json scan (data files are not in hbsPathToId)
  for (const [id, entry] of dr.discoveryMap) {
    if (entry.jsonPath === absPath) {
      return id.includes("~") ? id.split("~")[0] : id;
    }
  }
  return null;
}
