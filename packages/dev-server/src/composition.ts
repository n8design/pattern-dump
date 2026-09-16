// The composition graph: which components include which.
//
// One of the four derived graphs. Every edge here is derived from a static `{{> partial}}` include
// in the source — nothing is authored, so the graph cannot drift from the templates it describes.
//
// Depends only on `hbs-partials`; imports no server state. `CompositionRegistry` lives here because
// it is the type three other concerns pass around (css-closure, flattening surfacing, export
// planning) — giving it one home keeps those from importing it through index.ts.

import type { PatternDirs } from "./pattern-dirs.js";
import { readFile } from "node:fs/promises";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { parsePartialsFromHbs } from "./hbs-partials.js";

export interface CompositionRegistry {
  uses: Map<string, string[]>;
  usedBy: Map<string, string[]>;
}

/**
 * Build the bidirectional include graph.
 *
 * Both directions are materialised in one pass: `uses` from parsing each template, `usedBy` by
 * inverting as we go. Every known component gets an entry even when it has no edges, so callers can
 * distinguish "composes nothing" from "not a component" without a second lookup.
 *
 * Self-includes are skipped, and both maps are de-duplicated and sorted so the derived output is
 * stable across runs — a graph used as a refactor's regression test must not reorder spuriously.
 */
export async function buildCompositionRegistry(
  patternsDir: PatternDirs,
  flatNameToPath: Map<string, string>,
  discoveryMap: DiscoveryMap
): Promise<CompositionRegistry> {
  const uses = new Map<string, string[]>();
  const usedBy = new Map<string, string[]>();
  for (const id of flatNameToPath.values()) {
    if (!uses.has(id))   uses.set(id, []);
    if (!usedBy.has(id)) usedBy.set(id, []);
  }

  for (const componentId of flatNameToPath.values()) {
    const hbsPath = discoveryMap.get(componentId)?.hbsPath ?? "";
    let hbs = "";
    try { hbs = hbsPath ? await readFile(hbsPath, "utf-8") : ""; } catch { /* missing */ }

    const partialNames = parsePartialsFromHbs(hbs);
    const usedSet = new Set<string>();
    for (const partialName of partialNames) {
      const childId = flatNameToPath.get(partialName);
      if (childId && childId !== componentId) {
        usedSet.add(childId);
        const arr = usedBy.get(childId) ?? [];
        if (!arr.includes(componentId)) { arr.push(componentId); usedBy.set(childId, arr); }
      }
    }
    uses.set(componentId, [...usedSet].sort());
  }

  for (const [k, v] of usedBy) usedBy.set(k, [...new Set(v)].sort());
  return { uses, usedBy };
}
