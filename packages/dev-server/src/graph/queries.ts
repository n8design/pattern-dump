// Answers from the project graph (build.ts). Each reads only the graph, so the workbench, pd audit, pd build, the
// command line and the MCP tools that call one give the same answer.

import type { ClassNode, GraphEdge, GraphEdgeKind, LayoutPageUse, PageNode, RelationshipsAvailable } from "@pattern-dump/contracts";
import { componentNodeId, discoveryIdOf, type ProjectGraph } from "./build.js";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(cmp);

/** A node's edges of `kind`, out of it or into it. */
export function edgesOf(graph: ProjectGraph, nodeId: string, kind: GraphEdgeKind, dir: "out" | "in"): GraphEdge[] {
  return (graph[dir].get(nodeId) ?? []).filter(e => e.kind === kind);
}

/** The Relationships fields the graph holds for component (or variant) `id`: its includes both ways, the components
 *  and shared modules whose classes its template writes, the modules its stylesheet loads, and the classes no
 *  compiled stylesheet names. Empty for an id the graph doesn't have (a quarantined component). */
export function relationshipsOf(graph: ProjectGraph, id: string):
  Pick<RelationshipsAvailable, "uses" | "usedBy" | "styleUses" | "styleUsesModules" | "styleModules" | "unattributedClasses"> {
  const nodeId = componentNodeId(id);
  const classes = edgesOf(graph, nodeId, "borrows", "out").map(e => graph.nodes.get(e.to) as ClassNode);
  return {
    // By id, a variant beside its base (the graph's own order puts every component: before every variant:).
    uses: sortedUnique(edgesOf(graph, nodeId, "includes", "out").map(e => discoveryIdOf(e.to))),
    usedBy: sortedUnique(edgesOf(graph, nodeId, "includes", "in").map(e => discoveryIdOf(e.from))),
    styleUses: sortedUnique(classes.flatMap(c => (c.owner !== null && c.owner !== "base" && c.owner !== id ? [c.owner] : []))),
    styleUsesModules: edgesOf(graph, nodeId, "imports", "out").map(e => discoveryIdOf(e.to)),
    styleModules: sortedUnique(classes.flatMap(c => (c.owner === "base" && c.module ? [c.module] : []))),
    unattributedClasses: sortedUnique(classes.flatMap(c => (c.owner === null ? [discoveryIdOf(c.id)] : []))),
  };
}

/** The pages that render with layout `id`: the page files by path, then the generated pages by route. */
export function layoutPagesOf(graph: ProjectGraph, id: string): LayoutPageUse[] {
  const uses = edgesOf(graph, componentNodeId(id), "renders", "in").map(e => {
    const page = graph.nodes.get(e.from) as PageNode;
    return { e: e as Extract<GraphEdge, { kind: "renders" }>, page };
  });
  const files = uses.filter(u => u.page.file !== undefined)
    .map(({ e, page }) => ({
      route: page.route, path: page.file!, source: e.source as "own" | "folder" | "default", ...(e.via !== undefined ? { from: e.via } : {}),
    }) satisfies LayoutPageUse)
    .sort((a, b) => cmp(a.path, b.path));
  const generated = uses.filter(u => u.page.generated !== undefined)
    .map(({ page }) => ({
      route: page.route, source: "generated",
      generated: { kind: page.generated === "tags" || page.generated === "tag" ? "tag" : "category", ...(page.term !== undefined ? { term: page.term } : {}) },
    }) satisfies LayoutPageUse)
    .sort((a, b) => cmp(a.route, b.route));
  return [...files, ...generated];
}
