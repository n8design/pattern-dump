// `pd export` — the I/O half.
//
// Completes the split export.ts already started: the pure shaping (collapseFamily, buildRewriteMap,
// rewriteIncludes) lives there, and everything that touches disk lives here. That line is the whole
// reason the exporter is testable — the shaping can be exercised without a filesystem.
//
// What the exporter is FOR: hTWOo's own build output destroys variant identity
// (`checkbox~disabled` -> `checkbox-disabled.hbs`). `pd export` preserves `~`, which is what turns
// "PD can read hTWOo" into "PD can rewrite hTWOo correctly".
//
// Explicit arguments throughout; no server state.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { PatternDumpConfig } from "@pattern-dump/config";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { detectFlattening, type FlatteningInput } from "./flattening.js";
import {
  collapseFamily, buildRewriteMap, rewriteIncludes,
  type CollapsedFamily, type FamilyMember, type SkipReason,
} from "./export.js";
import { buildCompositionRegistry } from "./composition.js";

// ---- pd export (B7 slice 1: collapse-and-emit; slice 2: include-param threading) ------------------

/** A flattened family the export still cannot collapse — a member is included elsewhere (§7 hazard)
 *  AND it is NOT lossless shape (a), so there is no single `{{modifier}}` to thread. These are the
 *  shape-(b) (slice 3, multi-axis) and shape-(c) (separate collapse-builder track) families. Reported,
 *  never written. Slice 2 promotes the shape-(a) subset of the former deferred set to `threaded`. */
export interface DeferredFamily {
  members: string[];
  /** The `usedBy` include sites that make this a §7 hazard, keyed by member id. */
  hazardSites: Record<string, string[]>;
}

/** A flattened family that is include-consumed (§7 hazard) AND passes lossless shape (a) — so it
 *  collapses like a leaf family, but its `usedBy` include sites must be rewritten to thread the lifted
 *  `modifier` as an include param (D1 §6/§7). Slice 2's target. Written base+overlays like `collapse`,
 *  PLUS its includers are rewritten (add-never-overwrite) into the sink. */
export interface ThreadedFamily {
  family: CollapsedFamily;
  /** The `usedBy` include sites needing param threading, keyed by member id (slash ids of includers). */
  hazardSites: Record<string, string[]>;
}

/** A flattened cluster that is a §7 leaf but is NOT lossless shape (a) — its members differ beyond the
 *  root class (different markup/content), or span folders. Collapsing it would lose information, so it
 *  is skipped, never written. Reported so silent non-coverage never reads as "collapsed everything". */
export interface SkippedFamily {
  members: string[];
  reason: SkipReason;
}

/** The plan for one export run.
 *  - `collapse` — empty `usedBy` + lossless shape (a): base+overlays written, no include rewrite (slice 1).
 *  - `threaded` — non-empty `usedBy` + lossless shape (a): base+overlays written AND include sites
 *    rewritten to thread the modifier (slice 2, the shape-(a) subset of the former deferred set).
 *  - `deferred` — non-empty `usedBy` but NOT lossless shape (a): §7 hazard with no modifier to thread
 *    (shape (b) → slice 3; shape (c) → separate track). Reported, never written.
 *  - `skipped` — leaf (empty `usedBy`) but not lossless shape (a). */
export interface ExportPlan {
  collapse: CollapsedFamily[];
  threaded: ThreadedFamily[];
  deferred: DeferredFamily[];
  skipped: SkippedFamily[];
}

/**
 * Plan a `pd export` run WITHOUT writing: discover the corpus, run the flattening detector, and route
 * each cluster through the two-condition gate — (b) empty `usedBy` tree-wide, then (a) lossless shape
 * (a). Only families passing both are collapsed; the gate is the correctness precondition, not a
 * convenience. Pure of output side effects; the caller reports (Commit 2) or writes (Commit 3).
 *
 * Reuses the detector's own inputs/edges (mirrors surfaceFlattening) so the export considers exactly
 * the families PD already flags — one derived graph (flattening) feeding the next (export).
 */
export async function planExport(config: PatternDumpConfig, cwd: string): Promise<ExportPlan> {
  const patternsDir = resolve(cwd, config.patternsDir);
  const discovery = await buildDiscoveryMap(patternsDir);
  const registry = await buildCompositionRegistry(patternsDir, discovery.handleMap, discovery.discoveryMap);

  const inputs: FlatteningInput[] = [];
  const hbsById = new Map<string, string>();
  const relPathById = new Map<string, string>();
  const dataJsonById = new Map<string, string>();
  for (const [id, entry] of discovery.discoveryMap) {
    if (id.includes("~")) continue;        // variants annotate; never flatten-flagged
    if (!entry.hbsPath) continue;          // synthesized base-less node — no markup of its own
    try {
      const hbs = await readFile(entry.hbsPath, "utf-8");
      inputs.push({ id, hbs });
      hbsById.set(id, hbs);
      // Real patterns-relative path (no .hbs) — the collapsed id loses a base file's folder, so
      // family grouping must key on the path (see FamilyMember.relPath).
      relPathById.set(id, relative(patternsDir, entry.hbsPath).replace(/\.hbs$/, ""));
      // The member's sibling defaults data — must ride into the collapse (D1 §6) or the base renders empty.
      if (entry.jsonPath) {
        try { dataJsonById.set(id, await readFile(entry.jsonPath, "utf-8")); } catch { /* no defaults */ }
      }
    } catch { /* unreadable — skip, never crash the pass */ }
  }

  const hasEdge = (a: string, b: string): boolean =>
    (registry.uses.get(a)?.includes(b) ?? false) ||
    (registry.uses.get(b)?.includes(a) ?? false);

  const clusters = detectFlattening(inputs, { hasEdge });

  const collapse: CollapsedFamily[] = [];
  const threaded: ThreadedFamily[] = [];
  const deferred: DeferredFamily[] = [];
  const skipped: SkippedFamily[] = [];
  for (const cluster of clusters) {
    // Condition (b), tree-wide: a member included by anything makes the family a §7 hazard (the lifted
    // axis must thread through the include as a param).
    const hazardSites: Record<string, string[]> = {};
    for (const m of cluster.members) {
      const sites = registry.usedBy.get(m) ?? [];
      if (sites.length) hazardSites[m] = sites;
    }

    // Condition (a): lossless shape (a). collapseFamily verifies members are byte-identical except the
    // root-element class tokens; anything else → not shape (a).
    const members: FamilyMember[] = cluster.members.map((id) => ({
      id, relPath: relPathById.get(id) ?? id, hbs: hbsById.get(id) ?? "",
      ...(dataJsonById.has(id) ? { dataJson: dataJsonById.get(id) } : {}),
    }));
    const result = collapseFamily(cluster, members);

    if (Object.keys(hazardSites).length) {
      // Include-consumed. Slice 2 threads it ONLY if it also passes shape (a) — then there is a single
      // `{{modifier}}` to lift and thread. If it is not shape (a) (shape (b) multi-axis → slice 3; shape
      // (c) data/attribute → separate track), there is no modifier to thread: still deferred, never lossy.
      if (result.family) threaded.push({ family: result.family, hazardSites });
      else deferred.push({ members: cluster.members, hazardSites });
      continue;
    }

    // Leaf (empty usedBy) — slice 1 path unchanged.
    if (result.family) collapse.push(result.family);
    else skipped.push({ members: cluster.members, reason: result.skip! });
  }
  return { collapse, threaded, deferred, skipped };
}

/**
 * Write the corrected form of each collapsed family to `sink`: the base template at
 * `<baseId>.hbs` and one `<baseId>~<token>.json` overlay per non-default variant (the base-default
 * variant, token "", IS the base — no overlay). The base and its overlays are siblings so discovery's
 * Pass-3 re-derives the `~` variants from them. Faithful: `baseHbs` is the source skeleton verbatim
 * (drift preserved); the overlay carries only the lifted `modifier`.
 *
 * Returns the files written (relative to sink), sorted — deterministic, for the report and tests.
 */
export async function writeExport(families: CollapsedFamily[], sink: string): Promise<{ files: string[] }> {
  const files: string[] = [];
  for (const family of families) {
    const baseRel = `${family.baseId}.hbs`;
    const basePath = join(sink, baseRel);
    await mkdir(dirname(basePath), { recursive: true });
    await writeFile(basePath, family.baseHbs, "utf-8");
    files.push(baseRel);

    // Base defaults data (deep-inherited by every variant, D1 §6) — omitted when the base has none.
    if (family.baseData) {
      const dataRel = `${family.baseId}.json`;
      await writeFile(join(sink, dataRel), JSON.stringify(family.baseData, null, 2) + "\n", "utf-8");
      files.push(dataRel);
    }

    for (const v of family.variants) {
      if (v.token === "") continue; // base-default: the base template + base defaults already render it
      const overlayRel = `${family.baseId}~${v.token}.json`;
      // Overlay = the lifted modifier + any per-variant data delta (empty delta → modifier only).
      const overlay = { modifier: v.modifier, ...(v.data ?? {}) };
      await writeFile(join(sink, overlayRel), JSON.stringify(overlay, null, 2) + "\n", "utf-8");
      files.push(overlayRel);
    }
  }
  files.sort();
  return { files };
}

/**
 * Slice 2 — write the REWRITTEN includers of each threaded family into `sink`. For every `usedBy` site
 * of a threaded (include-consumed shape-(a)) family, the include is rewritten to point at the collapsed
 * base with the lifted `modifier` threaded as a param (add-never-overwrite; see `rewriteIncludes`).
 *
 * The rewrite map spans ALL threaded families, so an includer that consumes members of several is
 * rewritten once, completely. Includers are written at their real patterns-relative path (they are not
 * collapsed — only their include lines change). An includer whose sites didn't actually match (stale
 * `usedBy`) is skipped, never emitted as an unchanged copy.
 *
 * Rebuilds discovery to resolve includer file paths — a read-only pass, matching `planExport`'s style.
 */
export async function writeThreadedIncluders(
  threaded: ThreadedFamily[],
  patternsDir: string,
  sink: string,
): Promise<{ files: string[]; rewrites: number }> {
  if (!threaded.length) return { files: [], rewrites: 0 };
  const { discoveryMap } = await buildDiscoveryMap(patternsDir);
  const map = buildRewriteMap(threaded.map((t) => t.family));

  // Unique includer ids across every threaded family's hazard sites.
  const includerIds = new Set<string>();
  for (const t of threaded) {
    for (const sites of Object.values(t.hazardSites)) {
      for (const s of sites) includerIds.add(s);
    }
  }

  const files: string[] = [];
  let rewrites = 0;
  for (const id of [...includerIds].sort()) {
    const hbsPath = discoveryMap.get(id)?.hbsPath;
    if (!hbsPath) continue;
    let src = "";
    try { src = await readFile(hbsPath, "utf-8"); } catch { continue; }
    const res = rewriteIncludes(src, map);
    if (res.rewrites === 0) continue; // no site matched (stale usedBy) — do not emit an unchanged copy
    rewrites += res.rewrites;
    const rel = relative(patternsDir, hbsPath);
    const outPath = join(sink, rel);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, res.hbs, "utf-8");
    files.push(rel);
  }
  files.sort();
  return { files, rewrites };
}
