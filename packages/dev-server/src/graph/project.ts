// The project graph and its answers for a command that reads a project once (pd graph, pd describe, pd affected):
// the config resolved as pd dev resolves it, the graph built without a server (standalone.ts), as pd dev shows the
// site (drafts and scheduled pages in), and what the answers need besides it.

import { relative } from "node:path";
import type { PatternDumpConfig } from "@pattern-dump/config";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createDisplayPath } from "../display-path.js";
import { loadPatternPackages } from "../packages.js";
import { resolveServerConfig } from "../server-config.js";
import type { ProjectGraph } from "./build.js";
import { buildProjectGraph } from "./standalone.js";

export interface ProjectGraphRead {
  graph: ProjectGraph;
  discoveryMap: DiscoveryMap;
  /** The pages folder, root-relative with a trailing slash, when there is a site. */
  pagesPrefix?: string;
  /** How a file is named in the graph (display-path.ts): what `pd affected` turns a path it is given into. */
  display: (absPath: string) => string;
}

export async function readProjectGraph(config: PatternDumpConfig, root: string): Promise<ProjectGraphRead> {
  const cfg = resolveServerConfig(config, root, {}, loadPatternPackages(config.packages, root));
  const discovery = await buildDiscoveryMap(cfg.patternRoots);
  const graph = await buildProjectGraph(cfg, { live: true, discovery });
  const pagesDir = cfg.storefront?.pagesDir;
  return {
    graph, discoveryMap: discovery.discoveryMap,
    ...(pagesDir ? { pagesPrefix: `${relative(cfg.cwd, pagesDir).split("\\").join("/")}/` } : {}),
    display: createDisplayPath(cfg.cwd, cfg.packages),
  };
}
