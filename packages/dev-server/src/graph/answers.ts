// The answers the command line and the MCP tools give (contracts/src/graph.ts, "Answers"): contract, usage,
// ownership, blast radius and affected, each read from the project graph, so `pd describe`, `pd affected` and the
// tools of the same names give the same JSON. Only `contract` reads files (a schema, the docs), through discovery's
// paths; the rest read the graph alone.

import { readFile } from "node:fs/promises";
import {
  GRAPH_VERSION,
  type AffectedAnswer, type BlastRadiusAnswer, type ClassNode, type ComponentNode, type ContractAnswer, type DescribeAnswer,
  type DiscoveryMap, type GraphEdge, type GraphStep, type OwnershipAnswer, type PageNode, type StylesheetNode, type UsageAnswer,
  type VariantNode,
} from "@pattern-dump/contracts";
import { suggest } from "@pattern-dump/config";
import { frontmatterBody } from "../frontmatter.js";
import { componentNodeId, discoveryIdOf, type ProjectGraph } from "./build.js";
import { couplings, edgesOf, relationshipsOf } from "./queries.js";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const step = (e: GraphEdge): GraphStep => ({ from: e.from, kind: e.kind, to: e.to });

/** Thrown for an id the graph doesn't have, with the nearest ids by name: the command line exits 1 with its message,
 *  a tool answers it as an error. */
export class UnknownIdError extends Error {
  constructor(readonly id: string, readonly near: string[]) {
    super(`there is no component "${id}" in this project${near.length ? `: did you mean ${near.map(n => `"${n}"`).join(", ")}?` : ""}`);
    this.name = "UnknownIdError";
  }
}

/** The ids nearest to `id`: the closest by spelling (config's `suggest`, as a config key's did-you-mean), then the ones
 *  whose name contains its last segment, at most five. */
function nearIds(graph: ProjectGraph, id: string): string[] {
  const ids = [...graph.nodes.values()].filter(n => n.kind === "component" || n.kind === "variant").map(n => discoveryIdOf(n.id));
  const last = id.split("/").at(-1)!.toLowerCase();
  const closest = suggest(id, ids);
  return [...new Set([...(closest ? [closest] : []), ...ids.filter(x => x.toLowerCase().includes(last)).sort(cmp)])].slice(0, 5);
}

/** The node of component (or variant) `id`, or UnknownIdError. */
function componentNode(graph: ProjectGraph, id: string): ComponentNode | VariantNode {
  const node = graph.nodes.get(componentNodeId(id));
  if (!node || (node.kind !== "component" && node.kind !== "variant")) throw new UnknownIdError(id, nearIds(graph, id));
  return node;
}

/** `contract`: what component `id` accepts: its schema as written, its variants, its docs. */
export async function contractOf(graph: ProjectGraph, id: string, discoveryMap: DiscoveryMap): Promise<ContractAnswer> {
  const node = componentNode(graph, id);
  const entry = discoveryMap.get(id);
  let schema: unknown = null;
  let schemaError: string | undefined;
  if (entry?.schemaPath) {
    try { schema = JSON.parse(await readFile(entry.schemaPath, "utf8")); } catch (e) { schemaError = e instanceof Error ? e.message : String(e); }
  }
  let docs: string | null = null;
  if (entry?.mdPath) docs = await readFile(entry.mdPath, "utf8").then(md => frontmatterBody(md).trim(), () => null);
  const variants = edgesOf(graph, componentNodeId(id), "variant-of", "in")
    .map(e => graph.nodes.get(e.from) as VariantNode)
    .map(v => ({ id: discoveryIdOf(v.id), form: v.form }));
  return {
    version: GRAPH_VERSION, id,
    role: node.kind === "variant" ? "variant" : node.role,
    origin: node.origin,
    file: node.file,
    schema, ...(schemaError !== undefined ? { schemaError } : {}),
    variants, docs,
  };
}

/** `usage`: the components that include `id` directly, and every page that places it or renders with it, directly or
 *  through a component that includes it (or a variant of it). */
export function usageOf(graph: ProjectGraph, id: string): UsageAnswer {
  componentNode(graph, id);
  const start = componentNodeId(id);
  // Everything a page could place to show `id`: itself, its variants, and whatever includes any of them.
  const reached = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const next = queue.shift()!;
    for (const e of [...edgesOf(graph, next, "includes", "in"), ...edgesOf(graph, next, "variant-of", "in")]) {
      if (!reached.has(e.from)) { reached.add(e.from); queue.push(e.from); }
    }
  }
  const pages = new Map<string, UsageAnswer["pages"][number]>();
  for (const nodeId of reached) {
    for (const e of [...edgesOf(graph, nodeId, "places", "in"), ...edgesOf(graph, nodeId, "renders", "in")]) {
      const page = graph.nodes.get(e.from) as PageNode;
      const how = e.kind === "places" ? e.how : "renders";
      const through = nodeId === start ? undefined : discoveryIdOf(nodeId);
      const key = `${page.route}\u0000${how}\u0000${through ?? ""}`;
      pages.set(key, { route: page.route, how, ...(through !== undefined ? { through } : {}) });
    }
  }
  return {
    version: GRAPH_VERSION, id,
    components: edgesOf(graph, start, "includes", "in").map(e => discoveryIdOf(e.from)).sort(cmp),
    pages: [...pages.values()].sort((a, b) => cmp(a.route, b.route) || cmp(a.how, b.how) || cmp(a.through ?? "", b.through ?? "")),
  };
}

/** The classes of component `id`: the ones its own stylesheets define, and the ones the style index gives it. */
function classesOf(graph: ProjectGraph, id: string): Set<string> {
  const mine = new Set<string>();
  for (const own of edgesOf(graph, componentNodeId(id), "styled-by", "out")) {
    for (const d of edgesOf(graph, own.to, "defines", "out")) mine.add(d.to);
  }
  for (const n of graph.nodes.values()) if (n.kind === "class" && n.owner === id) mine.add(n.id);
  return mine;
}

/** `ownership`: the stylesheets that style component `id`, the classes it defines, the modules it loads, and the
 *  classes it shares with other components both ways. */
export function ownershipOf(graph: ProjectGraph, id: string): OwnershipAnswer {
  componentNode(graph, id);
  const rel = relationshipsOf(graph, id);
  const borrows = new Map<string, Set<string>>();
  for (const e of edgesOf(graph, componentNodeId(id), "borrows", "out")) {
    const cls = graph.nodes.get(e.to) as ClassNode;
    if (cls.owner === null || cls.owner === "base" || cls.owner === id.split("~")[0]) continue;
    let set = borrows.get(cls.owner);
    if (!set) borrows.set(cls.owner, set = new Set());
    set.add(discoveryIdOf(cls.id));
  }
  return {
    version: GRAPH_VERSION, id,
    stylesheets: rel.stylesheets,
    defines: [...classesOf(graph, id)].map(discoveryIdOf).sort(cmp),
    importsModules: rel.styleUsesModules,
    stylesClassesOf: couplings(graph, id, "out"),
    classesStyledBy: couplings(graph, id, "in"),
    borrows: [...borrows].sort(([a], [b]) => cmp(a, b)).map(([owner, classes]) => ({ owner, classes: [...classes].sort(cmp) })),
    unowned: rel.unattributedClasses,
  };
}

/**
 * `blast_radius`: what breaks if component `id` changes. Walked outwards, breadth first, so each thing is reached by
 * its shortest path, which comes with it:
 *   - a component or variant that includes it, at any depth, and its variants;
 *   - a stylesheet that styles one of its own classes in context (`mentions`), and the component that stylesheet is
 *     named after, which is walked on from (by what includes it);
 *   - a template that writes one of its own classes without including it (`borrows`), walked on from;
 *   - every page that places or renders with anything reached.
 */
export function blastRadiusOf(graph: ProjectGraph, id: string): BlastRadiusAnswer {
  componentNode(graph, id);
  const start = componentNodeId(id);
  const paths = new Map<string, GraphStep[]>([[start, []]]);
  const sheets = new Map<string, GraphStep[]>();
  const pages = new Map<string, GraphStep[]>();
  const queue = [start];
  const reach = (nodeId: string, path: GraphStep[]): void => {
    if (paths.has(nodeId)) return;
    paths.set(nodeId, path);
    queue.push(nodeId);
  };
  while (queue.length) {
    const at = queue.shift()!;
    const path = paths.get(at)!;
    for (const e of edgesOf(graph, at, "includes", "in")) reach(e.from, [...path, step(e)]);
    for (const e of edgesOf(graph, at, "variant-of", "in")) reach(e.from, [...path, step(e)]);
    // Only the changed component's classes change: a component reached on the way renders differently, but keeps its
    // own classes, so the rules that name them don't break.
    if (at === start && at.startsWith("component:")) {
      const self = discoveryIdOf(at);
      for (const cls of classesOf(graph, self)) {
        for (const m of edgesOf(graph, cls, "mentions", "in")) {
          const sheet = graph.nodes.get(m.from) as StylesheetNode;
          if (sheet.component === self) continue;
          const sheetPath = [...path, step(m)];
          if (!sheets.has(sheet.file)) sheets.set(sheet.file, sheetPath);
          if (sheet.component !== null) {
            const by = edgesOf(graph, sheet.id, "styled-by", "in").find(e => e.from === componentNodeId(sheet.component!));
            if (by) reach(by.from, [...sheetPath, step(by)]);
          }
        }
        for (const b of edgesOf(graph, cls, "borrows", "in")) {
          if (b.from !== at) reach(b.from, [...path, step(b)]);
        }
      }
    }
    for (const e of [...edgesOf(graph, at, "places", "in"), ...edgesOf(graph, at, "renders", "in")]) {
      const route = (graph.nodes.get(e.from) as PageNode).route;
      if (!pages.has(route)) pages.set(route, [...path, step(e)]);
    }
  }
  paths.delete(start);
  return {
    version: GRAPH_VERSION, id,
    components: [...paths].map(([nodeId, p]) => ({ id: discoveryIdOf(nodeId), path: p })).sort((a, b) => cmp(a.id, b.id)),
    stylesheets: [...sheets].map(([file, p]) => ({ file, path: p })).sort((a, b) => cmp(a.file, b.file)),
    pages: [...pages].map(([route, p]) => ({ route, path: p })).sort((a, b) => cmp(a.route, b.route)),
  };
}

/** The four answers for one component: `pd describe <id> --json`. */
export async function describeOf(graph: ProjectGraph, id: string, discoveryMap: DiscoveryMap): Promise<DescribeAnswer> {
  return {
    version: GRAPH_VERSION, id,
    contract: await contractOf(graph, id, discoveryMap),
    usage: usageOf(graph, id),
    ownership: ownershipOf(graph, id),
    blastRadius: blastRadiusOf(graph, id),
  };
}

/**
 * `affected`: everything a change reaches, as the flat list to check. `ids`: components or variants; `files`: changed
 * files, root-relative as the graph names them (a package's as `<name>/<path>`), each mapped to what it is: a
 * template, schema or docs to its component, a stylesheet to its component (or, for one no component is named after,
 * to the components whose templates write a class it defines), a shared Sass module to the components that load it, a
 * page file to its page (`pagesPrefix`: the pages folder, root-relative). What the graph doesn't know is `unknown`.
 */
export function affectedOf(graph: ProjectGraph, ask: { ids?: readonly string[]; files?: readonly string[] }, pagesPrefix?: string): AffectedAnswer {
  const changed = new Set<string>();
  const unknown: string[] = [];
  const components = new Set<string>();
  const pages = new Set<string>();
  const add = (id: string): void => {
    components.add(id);
    const radius = blastRadiusOf(graph, id);
    for (const c of radius.components) components.add(c.id);
    for (const p of radius.pages) pages.add(p.route);
  };
  for (const id of ask.ids ?? []) {
    if (graph.nodes.has(componentNodeId(id))) { changed.add(id); add(id); } else unknown.push(id);
  }
  const byFile = new Map<string, string[]>();
  const note = (file: string, nodeId: string): void => { byFile.set(file, [...byFile.get(file) ?? [], nodeId]); };
  for (const n of graph.nodes.values()) {
    if (n.kind === "component") for (const f of [n.file, n.schema, n.docs]) if (f) note(f, n.id);
    if (n.kind === "variant") note(n.file, n.id);
    if (n.kind === "stylesheet" && n.source !== "inline" && n.source !== "external") note(n.file, n.id);
    if (n.kind === "page" && n.file !== undefined && pagesPrefix !== undefined) note(`${pagesPrefix}${n.file}`, n.id);
  }
  for (const file of ask.files ?? []) {
    const nodes = byFile.get(file) ?? moduleOf(graph, file);
    if (!nodes.length) { unknown.push(file); continue; }
    changed.add(file);
    for (const nodeId of nodes) {
      const node = graph.nodes.get(nodeId)!;
      if (node.kind === "component" || node.kind === "variant") add(discoveryIdOf(nodeId));
      else if (node.kind === "page") pages.add(node.route);
      else if (node.kind === "module") for (const e of edgesOf(graph, nodeId, "imports", "in")) add(discoveryIdOf(e.from));
      else if (node.kind === "stylesheet") {
        if (node.component !== null) add(node.component);
        else {
          for (const d of edgesOf(graph, nodeId, "defines", "out")) {
            for (const b of edgesOf(graph, d.to, "borrows", "in")) add(discoveryIdOf(b.from));
          }
        }
      }
    }
  }
  return {
    version: GRAPH_VERSION,
    changed: [...changed].sort(cmp), unknown: unknown.sort(cmp),
    components: [...components].sort(cmp), pages: [...pages].sort(cmp),
  };
}

/** The shared Sass module a file is, by the module's path in its styles folder (`00-base/tokens` for
 *  `src/styles/00-base/_tokens.scss`). */
function moduleOf(graph: ProjectGraph, file: string): string[] {
  const parts = file.replace(/\.(scss|css)$/, "").split("/");
  parts[parts.length - 1] = parts[parts.length - 1]!.replace(/^_/, "");
  const plain = `/${parts.join("/")}`;
  return [...graph.nodes.values()].filter(n => n.kind === "module" && plain.endsWith(`/${discoveryIdOf(n.id)}`)).map(n => n.id);
}
