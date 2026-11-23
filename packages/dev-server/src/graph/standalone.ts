// The project graph without a server: for pd audit, pd graph, pd describe and pd mcp, which read a project once (or
// keep their own watcher) instead of asking a running pd dev. Built by the same gatherer and builder as pd dev's
// (inputs.ts, build.ts) from the same kind of inputs, read here instead of taken from a server's caches. A caller that
// has built discovery or the include graph already passes them, so it is the graph of the same reading.

import type { DiscoveryResult } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { buildCompositionRegistry, type CompositionRegistry } from "../composition.js";
import { baseComponentIds } from "../discovery-index.js";
import { createDisplayPath } from "../display-path.js";
import type { ResolvedConfig } from "../server-config.js";
import { todayOf } from "../storefront/pages.js";
import { sitePagesRead } from "../storefront/site-pages.js";
import { buildAllStyleData } from "../style-index.js";
import { buildGraph, type ProjectGraph } from "./build.js";
import { gatherGraphInputs } from "./inputs.js";

export interface StandaloneGraphOptions {
  /** As pd dev reads the site (drafts and scheduled pages in), or as pd build does (left out). */
  live: boolean;
  discovery?: DiscoveryResult;
  composition?: CompositionRegistry;
  /** The day scheduled pages are measured against; default: today's. */
  today?: string;
}

export async function buildProjectGraph(cfg: ResolvedConfig, o: StandaloneGraphOptions): Promise<ProjectGraph> {
  const discovery = o.discovery ?? await buildDiscoveryMap(cfg.patternRoots);
  const composition = o.composition ?? await buildCompositionRegistry(cfg.patternDirs, discovery.handleMap, discovery.discoveryMap);
  const style = await buildAllStyleData(cfg.styleRoots, baseComponentIds(discovery));
  const pages = cfg.storefront
    ? await (await sitePagesRead(cfg.storefront, { live: o.live, today: o.today ?? todayOf(new Date()), discoveryMap: discovery.discoveryMap })).read()
    : null;
  return buildGraph(await gatherGraphInputs({
    discovery, composition, style, pages,
    assetsCss: cfg.assetsCss, assetRoots: cfg.assetRoots, assetRootNames: cfg.assetRootNames,
    display: createDisplayPath(cfg.cwd, cfg.packages),
  }));
}
