// Derived-artifact surfacing: findings that are about a SET of components, not one.
//
// Both follow the same shape — derive, warn on the console, then write a `*.generated.md` into the
// per-root scratch dir, degrading quietly if that write fails. They sit outside the diagnostics
// graph deliberately: that graph is per-component/per-rule and cannot hold a cluster or a
// collision pair.
//
// The reports are DERIVED, never authoritative — never parse one back, always re-derive.
//
// One asymmetry to preserve: `surfaceCollisions` takes the hotreloader because a collision is
// actionable live in the workbench (it becomes an HMR CollisionMessage on the Console); flattening
// is console-plus-artifact only.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CollisionEntry, CollisionMessage, DiscoveryMap } from "@pattern-dump/contracts";
import type { HotReloader } from "@pattern-dump/hotreloader";
import { detectFlattening, renderFlatteningReport, type FlatteningInput } from "./flattening.js";
import type { CompositionRegistry } from "./composition.js";
import { pdScratchDir } from "./scratch.js";

/** Emit CollisionMessage events to the hotreloader and write CONFLICTS.generated.md.
 *  Called after every buildDiscoveryMap pass (startup + every tree-changed rebuild).
 *  The current set is also RETAINED, so a browser that connects later — including after a startup
 *  pass, when no browser is connected yet — still sees every live collision. A resolved collision
 *  drops out of the retained set on the next pass.
 *  CONFLICTS.generated.md is deterministic: "no conflicts" when empty. Never parse it — always re-derive. */
export async function surfaceCollisions(
  collisions: CollisionEntry[],
  cwd: string,
  hotreloader: Pick<HotReloader, "push" | "retain">
): Promise<void> {
  const messages: CollisionMessage[] = collisions.map(col => (
    { type: "collision", handle: col.handle, incumbentPath: col.incumbentPath, quarantinedPath: col.quarantinedPath }
  ));
  hotreloader.retain(messages);
  for (const [i, col] of collisions.entries()) {
    hotreloader.push(messages[i]);
    console.warn(`[dev-server] HANDLE_COLLISION: "${col.handle}" — incumbent: ${col.incumbentPath} — quarantined: ${col.quarantinedPath}`);
  }
  const md = collisions.length === 0
    ? "# Conflicts\n\nNo handle collisions detected.\n"
    : [
        "# Conflicts",
        "",
        `${collisions.length} handle collision${collisions.length > 1 ? "s" : ""} detected. ` +
          "Quarantined components are excluded from the tree until the collision is resolved.",
        "",
        ...collisions.flatMap(c => [
          `## \`${c.handle}\``,
          `- **incumbent**: \`${c.incumbentPath}\``,
          `- **quarantined**: \`${c.quarantinedPath}\``,
          "",
        ]),
      ].join("\n");
  // Never write into the project root (it may be read-only / not ours). Emit to a PD-owned
  // scratch dir outside the root; the collisions are also pushed to the Console above, so a
  // failed write degrades to "diagnostic on the Console only", never a crash.
  try {
    const dir = pdScratchDir(cwd);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "CONFLICTS.generated.md"), md, "utf-8");
  } catch (e) {
    console.warn("[dev-server] Could not write CONFLICTS.generated.md to scratch dir:", e);
  }
}

/**
 * Corpus-level flattening diagnostic ([SUBJECT-DEBT]) — a set-of-components finding surfaced as a
 * generated side artifact, exactly like surfaceCollisions/CONFLICTS.generated.md. NOT in the
 * diagnostics graph (its per-component/single-engine shape can't hold a cluster). Detects near-
 * duplicate templates flattened along a class-token; the composition graph sharpens it (a wrapper
 * that includes a base is excluded, not flagged). Pure detection lives in ./flattening.
 *
 * Variants (ids with `~`) are excluded: `~` is the RIGHT way to express variation, never flattening
 * debt — and data-overlay variants share the base's .hbs, so including them would self-cluster.
 */
export async function surfaceFlattening(
  discoveryMap: DiscoveryMap,
  registry: CompositionRegistry,
  cwd: string,
): Promise<void> {
  const inputs: FlatteningInput[] = [];
  for (const [id, entry] of discoveryMap) {
    if (id.includes("~")) continue;      // variants annotate; never flatten-flagged
    if (entry.source) continue;          // a pattern package's templates are library code, not this project's debt
    if (!entry.hbsPath) continue;        // synthesized base-less node — no markup of its own
    try {
      inputs.push({ id, hbs: await readFile(entry.hbsPath, "utf-8") });
    } catch { /* unreadable — skip, never crash the pass */ }
  }

  const hasEdge = (a: string, b: string): boolean =>
    (registry.uses.get(a)?.includes(b) ?? false) ||
    (registry.uses.get(b)?.includes(a) ?? false);

  const clusters = detectFlattening(inputs, { hasEdge });
  const md = renderFlatteningReport(clusters);

  if (clusters.length) {
    const members = clusters.reduce((n, c) => n + c.members.length, 0);
    console.warn(`[dev-server] FLATTENED: ${clusters.length} cluster(s) across ${members} components — see FLATTENED.generated.md`);
  }

  // Never write into the (possibly read-only) project root — emit to the PD-owned scratch dir. A
  // failed write degrades to "no artifact", never a crash (mirrors surfaceCollisions).
  try {
    const dir = pdScratchDir(cwd);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "FLATTENED.generated.md"), md, "utf-8");
  } catch (e) {
    console.warn("[dev-server] Could not write FLATTENED.generated.md to scratch dir:", e);
  }
}
