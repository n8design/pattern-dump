// Answers from the project graph (build.ts). Each reads only the graph, so the workbench, pd audit, pd build, the
// command line and the MCP tools that call one give the same answer.

import type {
  AuditStyle, ClassNode, GraphEdge, GraphEdgeKind, LayoutPageUse, PageNode, RelationshipsAvailable, StyleCoupling, StylesheetNode,
} from "@pattern-dump/contracts";
import { componentNodeId, discoveryIdOf, type ProjectGraph } from "./build.js";
import { nameMatcher } from "../storefront/css-vocabulary.js";

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

/** Component (or variant) `id` and everything it includes, however deep; a variant brings its base too, as a render
 *  of it does (diagnostics.ts, includeClosure). */
export function includeClosureOf(graph: ProjectGraph, id: string): Set<string> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    if (next.includes("~")) queue.push(next.slice(0, next.indexOf("~")));
    for (const e of edgesOf(graph, componentNodeId(next), "includes", "out")) queue.push(discoveryIdOf(e.to));
  }
  return seen;
}

/**
 * The owners whose stylesheets component (or variant) `id`'s template links only by borrowing: it writes a class they
 * own, and it doesn't include them (css-closure.ts, borrowedStyles, the same rule over the graph). `componentId`: the
 * component it is shown on (a variant's base). Sorted by owner, each owner's classes sorted.
 */
export function borrowedOf(graph: ProjectGraph, id: string, componentId = id.split("~")[0]!): Array<{ owner: string; classes: string[] }> {
  const included = includeClosureOf(graph, id);
  const byOwner = new Map<string, Set<string>>();
  for (const e of edgesOf(graph, componentNodeId(id), "borrows", "out")) {
    const cls = graph.nodes.get(e.to) as ClassNode;
    const owner = cls.owner;
    if (owner === null || owner === "base" || owner === componentId || included.has(owner)) continue;
    let set = byOwner.get(owner);
    if (!set) byOwner.set(owner, set = new Set());
    set.add(discoveryIdOf(cls.id));
  }
  return [...byOwner].sort(([a], [b]) => a.localeCompare(b)).map(([owner, classes]) => ({ owner, classes: [...classes].sort() }));
}

/** The style couplings of components `ids` (AuditStyle), for the audit: what each borrows, whose classes its
 *  stylesheets style, and the custom properties it reads that nothing declares (`allow`: styles.allowProperties). A
 *  variant's undeclared properties are listed only where they differ from its base's (a data variant has its base's).
 *  Sorted by component. */
export function auditStyleOf(graph: ProjectGraph, ids: Iterable<string>, allow: readonly string[] = []): AuditStyle {
  const style: AuditStyle = { borrowed: [], couplings: [], undeclared: [] };
  const key = (list: UndeclaredProperty[]): string => JSON.stringify(list);
  for (const id of [...ids].sort(cmp)) {
    if (!graph.nodes.has(componentNodeId(id))) continue;
    for (const b of borrowedOf(graph, id)) style.borrowed.push({ component: id, ...b });
    for (const c of couplings(graph, id, "out")) style.couplings.push({ from: id, ...c });
    const undeclared = undeclaredPropertiesOf(graph, id, allow);
    if (id.includes("~") && key(undeclared) === key(undeclaredPropertiesOf(graph, id.split("~")[0]!, allow))) continue;
    for (const u of undeclared) style.undeclared.push({ component: id, ...u });
  }
  return style;
}

/** A custom property a component reads without a fallback that nothing declares: the rules that read it so. */
export interface UndeclaredProperty { property: string; selectors: string[] }

/** The custom properties component (or variant) `id` reads (propertiesOf) without a fallback, that no stylesheet or
 *  theme declares and `allow` (styles.allowProperties, names or prefixes with `*`) doesn't list, each with the rules
 *  that read it without one, sorted. A property every use gives a fallback is an API property with a default. The
 *  one rule behind PROPERTY_UNDECLARED on the component's detail and in the audit. */
export function undeclaredPropertiesOf(graph: ProjectGraph, id: string, allow: readonly string[]): UndeclaredProperty[] {
  const allowed = nameMatcher(allow);
  return propertiesOf(graph, id).flatMap(p => {
    if (p.declaredBy.length > 0 || allowed(p.name)) return [];
    const selectors = [...new Set([...p.own, ...p.context].filter(u => u.fallback === undefined).map(u => u.selector))].sort(cmp);
    return selectors.length ? [{ property: p.name, selectors }] : [];
  });
}

/** One custom property component (or variant) `id` uses, through the classes its template writes: its own uses
 *  (the rule styles the class), its uses in context (only inside other classes, `within`), and the stylesheets and
 *  themes that declare it (none: declared nowhere PD reads). A use's `fallback`: the default its var() gives, as
 *  written ("Adjust with --x, default 30rem"); absent when a read there has none. */
export interface ComponentProperty {
  name: string;
  own: Array<{ class: string; selector: string; fallback?: string }>;
  context: Array<{ class: string; selector: string; within: string[]; fallback?: string }>;
  declaredBy: Array<{ file: string; source: StylesheetNode["source"]; selector: string }>;
}

/** The custom properties component (or variant) `id` uses, by name: one query for the Relationships tab, Kiosk and
 *  the MCP. A data variant writes its base's classes, so it has its base's. Empty for an id the graph doesn't have. */
export function propertiesOf(graph: ProjectGraph, id: string): ComponentProperty[] {
  const byName = new Map<string, ComponentProperty>();
  for (const b of edgesOf(graph, componentNodeId(id), "borrows", "out")) {
    const cls = discoveryIdOf(b.to);
    for (const e of edgesOf(graph, b.to, "uses-property", "out") as Array<Extract<GraphEdge, { kind: "uses-property" }>>) {
      const name = discoveryIdOf(e.to);
      let p = byName.get(name);
      if (!p) {
        const declaredBy = (edgesOf(graph, e.to, "declares", "in") as Array<Extract<GraphEdge, { kind: "declares" }>>).map(d => {
          const sheet = graph.nodes.get(d.from) as StylesheetNode;
          return { file: sheet.file, source: sheet.source, selector: d.selector };
        });
        byName.set(name, p = { name, own: [], context: [], declaredBy });
      }
      const fallback = e.fallback !== undefined ? { fallback: e.fallback } : {};
      if (e.context) p.context.push({ class: cls, selector: e.selector, within: e.within ?? [], ...fallback });
      else p.own.push({ class: cls, selector: e.selector, ...fallback });
    }
  }
  return [...byName.values()].sort((a, b) => cmp(a.name, b.name));
}
