// Headless `pd audit` — the CLI entry point into the diagnostics sweep.
//
// It deliberately re-does the same config -> renderer -> discovery bootstrap that startDevServer
// performs, because the whole point is that the CLI and the workbench panel run the IDENTICAL
// sweep over the IDENTICAL renderer setup (project helpers, global data, discovery). If this
// bootstrapped differently, `pd audit` and the Audit facet could disagree about the same corpus,
// and neither number would be trustworthy.
//
// `export-io.ts` does the same thing for `pd export`; that duplication is the price of having two
// entry points, and is preferable to routing the CLI through a running HTTP server.
//
// Public contract: packages/core imports `runDiagnosticsAudit`, so index.ts re-exports it.

import type { PatternDumpConfig } from "@pattern-dump/config";
import type { DiagnosticsGraph } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { baseComponentIds } from "./discovery-index.js";
import { loadHelperRegistrars, loadGlobalData } from "./project-loaders.js";
import { buildCompositionRegistry } from "./composition.js";
import { surfaceFlattening } from "./surfacing.js";
import { refreshDiagnosticsGraph, graphArtifactPath, type CheckRenderer } from "./diagnostics.js";
import { resolveServerConfig } from "./server-config.js";
import { loadPatternPackages } from "./packages.js";
import { createDisplayPath } from "./display-path.js";

/**
 * Headless `pd audit` — build (or hash-refresh) the diagnostics graph WITHOUT starting the HTTP server.
 * Reuses the exact renderer init the live server uses (discovery, project helpers, global data) so the
 * findings cannot diverge from the panel, then runs the same sweep. Returns the graph and where the
 * serialized JSON artifact landed (a PD-owned path outside the project root).
 */
export async function runDiagnosticsAudit(
  config: PatternDumpConfig, cwd: string,
): Promise<{ graph: DiagnosticsGraph; reaudited: string[]; reused: number; artifactPath: string }> {
  const cfg = resolveServerConfig(config, cwd, {}, loadPatternPackages(config.packages, cwd));
  const { patternsDir, patternRoots, patternDirs, themesDir, defaultTheme } = cfg;
  const helperRegistrars: Awaited<ReturnType<typeof loadHelperRegistrars>> = [];
  for (const path of cfg.helperPaths) helperRegistrars.push(...await loadHelperRegistrars(path));
  const globalData = cfg.dataDirs.length ? await loadGlobalData(cfg.dataDirs) : undefined;
  const render = createRenderer({
    patternsDir, patternRoots, themesDir: themesDir ?? undefined, defaultTheme,
    displayPath: createDisplayPath(cwd, cfg.packages),
    ...(helperRegistrars.length ? { helperRegistrars } : {}),
    ...(globalData ? { globalData } : {}),
  }) as CheckRenderer;

  const discovery = await buildDiscoveryMap(patternRoots);
  const { graph, reaudited, reused } = await refreshDiagnosticsGraph(
    cwd, baseComponentIds(discovery), render, discovery.quarantineMap, discovery.discoveryMap, globalData,
  );
  // Headless one-shot also emits the flattening side artifact. This path builds neither collisions
  // nor the composition registry, so build the registry here for the pass.
  const registry = await buildCompositionRegistry(patternDirs, discovery.handleMap, discovery.discoveryMap);
  await surfaceFlattening(discovery.discoveryMap, registry, cwd);
  return { graph, reaudited, reused, artifactPath: graphArtifactPath(cwd) };
}
