// Answers from the project graph (build.ts). Each reads only the graph, so the workbench, pd audit, pd build, the
// command line and the MCP tools that call one give the same answer.

import type {
  ClassNode, GraphEdge, GraphEdgeKind, LayoutPageUse, PageNode, RelationshipsAvailable, StyleCoupling, StylesheetNode,
} from "@pattern-dump/contracts";
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
  Pick<RelationshipsAvailable, "uses" | "usedBy" | "styleUses" | "styleUsesModules" | "styleModules" | "unattributedClasses"
    | "stylesheets" | "stylesClassesOf" | "classesStyledBy"> {
  const nodeId = componentNodeId(id);
  const classes = edgesOf(graph, nodeId, "borrows", "out").map(e => graph.nodes.get(e.to) as ClassNode);
  return {
    // By id, a variant beside its base (the graph's own order puts every component: before every variant:).
    uses: sortedUnique(edgesOf(graph, nodeId, "includes", "out").map(e => discoveryIdOf(e.to))),
    usedBy: sortedUnique(edgesOf(graph, nodeId, "includes", "in").map(e => discoveryIdOf(e.from))),
    styleUses: sortedUnique(classes.flatMap(c => (c.owner !== null && c.owner !== "base" && c.owner !== id ? [c.owner] : []))),
    styleUsesModules: edgesOf(graph, nodeId, "imports", "out").map(e => discoveryIdOf(e.to)),
    styleModules: sortedUnique(classes.flatMap(c => (c.owner === "base" && c.module ? [c.module] : []))),
    // A class no compiled stylesheet owns, and no other stylesheet (an assets.css file, a template's <style>) defines.
    unattributedClasses: sortedUnique(classes.flatMap(c =>
      (c.owner === null && edgesOf(graph, c.id, "defines", "in").length === 0 ? [discoveryIdOf(c.id)] : []))),
    stylesheets: edgesOf(graph, nodeId, "styled-by", "out").map(e => {
      const sheet = graph.nodes.get(e.to) as StylesheetNode;
      return { file: sheet.file, source: sheet.source };
    }),
    stylesClassesOf: couplings(graph, id, "out"),
    classesStyledBy: couplings(graph, id, "in"),
  };
}

/**
 * The style couplings of component `id`: "out", where its own stylesheets style another component's classes in
 * context (a `mentions` edge to a class another component owns); "in", where another component's stylesheets style
 * its classes. Each by the other component and the stylesheet, classes sorted, couplings by component then stylesheet.
 */
export function couplings(graph: ProjectGraph, id: string, dir: "out" | "in"): StyleCoupling[] {
  const found = new Map<string, StyleCoupling>();
  const add = (component: string, stylesheet: string, name: string, selector: string): void => {
    const key = `${component}\u0000${stylesheet}`;
    let c = found.get(key);
    if (!c) { c = { component, stylesheet, classes: [] }; found.set(key, c); }
    if (!c.classes.some(x => x.name === name)) c.classes.push({ name, selector });
  };
  if (dir === "out") {
    for (const own of edgesOf(graph, componentNodeId(id), "styled-by", "out")) {
      const sheet = graph.nodes.get(own.to) as StylesheetNode;
      for (const m of edgesOf(graph, sheet.id, "mentions", "out") as Array<Extract<GraphEdge, { kind: "mentions" }>>) {
        const cls = graph.nodes.get(m.to) as ClassNode;
        if (cls.owner !== null && cls.owner !== "base" && cls.owner !== id) add(cls.owner, sheet.file, discoveryIdOf(cls.id), m.selector);
      }
    }
  } else {
    // Its classes: the ones its own stylesheets define, and the ones the style index gives it.
    const mine = new Set<string>();
    for (const own of edgesOf(graph, componentNodeId(id), "styled-by", "out")) {
      for (const d of edgesOf(graph, own.to, "defines", "out")) mine.add(d.to);
    }
    for (const n of graph.nodes.values()) if (n.kind === "class" && n.owner === id) mine.add(n.id);
    for (const clsId of mine) {
      for (const m of edgesOf(graph, clsId, "mentions", "in") as Array<Extract<GraphEdge, { kind: "mentions" }>>) {
        const sheet = graph.nodes.get(m.from) as StylesheetNode;
        if (sheet.component !== null && sheet.component !== id) add(sheet.component, sheet.file, discoveryIdOf(clsId), m.selector);
      }
    }
  }
  for (const c of found.values()) c.classes.sort((a, b) => cmp(a.name, b.name));
  return [...found.values()].sort((a, b) => cmp(a.component, b.component) || cmp(a.stylesheet, b.stylesheet));
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
