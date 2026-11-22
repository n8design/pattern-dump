// The project graph, built from what the server already holds: discovery, the include graph, the style data, the
// templates' text, the assets.css sheets, the site's pages and each component's requires. PURE: the same inputs give
// the same graph, with no I/O, so pd dev, pd build, pd audit, pd graph and pd mcp give the same answers (they share
// this builder, not copies of it). inputs.ts gathers the inputs; queries.ts answers from the graph.
//
// Adjacency maps, both directions, every list sorted: the JSON is the same bytes for the same project.

import { extname } from "node:path";
import {
  GRAPH_VERSION,
  type ComponentRole, type DiscoveryResult, type GraphEdge, type GraphNode, type GraphOrigin, type ProjectGraphJson,
} from "@pattern-dump/contracts";
import type { CompositionRegistry } from "../composition.js";
import type { AllStyleData } from "../style-index.js";
import { inlineStyleClasses, linkedStylesheets, type AssetStylesheet, type SheetClasses } from "../plain-stylesheets.js";
import { templateClasses } from "../css-closure.js";

/** A page of the site, as the graph needs it. */
export interface GraphPageInput {
  route: string;
  /** Relative to the pages folder; absent for a generated page. */
  file?: string;
  generated?: "tag" | "tags" | "category" | "categories";
  /** The layout component it renders with, and how it got it. */
  layout?: { id: string; source: "own" | "folder" | "default" | "generated"; via?: string };
  /** What it places, each with how (a `pd-` tag, a `pattern` fence, its listing's view or the view's card). */
  places: Array<{ id: string; how: "tag" | "pattern" | "view" | "card" }>;
}

export interface GraphInputs {
  discovery: DiscoveryResult;
  composition: CompositionRegistry;
  style: AllStyleData;
  /** The layouts' component ids (layout-index.ts). */
  layouts: ReadonlySet<string>;
  /** The template text each component and variant renders, by id: a data variant's is its base's. */
  templates: ReadonlyMap<string, string>;
  /** The project's assets.css entries (plain-stylesheets.ts). */
  assetSheets: readonly AssetStylesheet[];
  pages: readonly GraphPageInput[];
  /** Each component's own requires (not its includes'), by id. */
  requires: ReadonlyMap<string, { scripts: readonly string[]; assets: readonly string[] }>;
  /** How a file is named in output: relative to the root, a package's as `<name>/<path>` (display-path.ts). */
  display: (absPath: string) => string;
}

/** The graph in memory: its nodes by id, and each node's edges out and in. */
export interface ProjectGraph {
  nodes: ReadonlyMap<string, GraphNode>;
  out: ReadonlyMap<string, readonly GraphEdge[]>;
  in: ReadonlyMap<string, readonly GraphEdge[]>;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const edgeKey = (e: GraphEdge): string => `${e.from}\u0000${e.kind}\u0000${e.to}`;

/** The node id of a discovery id: a variant's has `~`. */
export const componentNodeId = (id: string): string => (id.includes("~") ? `variant:${id}` : `component:${id}`);
/** The discovery id of a component or variant node id. */
export const discoveryIdOf = (nodeId: string): string => nodeId.slice(nodeId.indexOf(":") + 1);

function roleOf(id: string, layouts: ReadonlySet<string>): ComponentRole {
  if (layouts.has(id)) return "layout";
  if (id.startsWith("partials/")) return "partial";
  if (/^views\/[^/~]+$/.test(id)) return "view";
  return "component";
}

export function buildGraph(inputs: GraphInputs): ProjectGraph {
  const { discovery, composition, style, display } = inputs;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (n: GraphNode): void => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const edge = (e: GraphEdge): void => { const k = edgeKey(e); if (!edges.has(k)) edges.set(k, e); };
  const origin = (source: string | undefined): GraphOrigin => (source ? { package: source } : { project: true });
  const classNode = (name: string): string => {
    const id = `class:${name}`;
    if (!nodes.has(id)) {
      const owner = style.classOwnerIndex.get(name);
      node({ id: id as `class:${string}`, kind: "class", owner: owner === undefined ? null : owner === "__base__" ? "base" : owner });
    }
    return id;
  };
  const sheetEdges = (sheetId: string, classes: SheetClasses): void => {
    for (const [name, selector] of classes.defines) edge({ kind: "defines", from: sheetId, to: classNode(name), selector });
    for (const [name, selector] of classes.mentions) edge({ kind: "mentions", from: sheetId, to: classNode(name), selector });
  };

  // Components and variants.
  for (const [id, entry] of discovery.discoveryMap) {
    if (id.includes("~")) {
      const base = id.slice(0, id.indexOf("~"));
      const markup = entry.hbsPath !== "" && /~[^/]*\.hbs$/.test(entry.hbsPath);
      const file = markup ? entry.hbsPath : entry.jsonPath ?? entry.hbsPath;
      node({ id: `variant:${id}`, kind: "variant", origin: origin(entry.source), of: base, form: markup ? "markup" : "data", file: display(file) });
      edge({ kind: "variant-of", from: `variant:${id}`, to: `component:${base}` });
    } else {
      node({
        id: `component:${id}`, kind: "component", role: roleOf(id, inputs.layouts), origin: origin(entry.source),
        file: entry.ownMarkup && entry.hbsPath ? display(entry.hbsPath) : null,
        schema: entry.schemaPath ? display(entry.schemaPath) : null,
        docs: entry.mdPath ? display(entry.mdPath) : null,
      });
    }
  }
  const known = (id: string): boolean => nodes.has(componentNodeId(id));

  // Includes.
  for (const [id, children] of composition.uses) {
    if (!known(id)) continue;
    for (const child of children) if (known(child)) edge({ kind: "includes", from: componentNodeId(id), to: componentNodeId(child) });
  }

  // Compiled stylesheets: each authoring file, with the classes it defines and mentions.
  for (const [path, sheet] of style.stylesheets) {
    const id = `stylesheet:${display(path)}`;
    const component = sheet.component && known(sheet.component) ? sheet.component : null;
    const entry = component ? discovery.discoveryMap.get(component) : undefined;
    node({ id: id as `stylesheet:${string}`, kind: "stylesheet", origin: origin(entry?.source), component, source: extname(path) === ".css" ? "css" : "scss", file: display(path) });
    if (component) edge({ kind: "styled-by", from: componentNodeId(component), to: id });
    sheetEdges(id, sheet);
  }
  for (const [id, modules] of style.scssModuleGraph.styleUsesModules) {
    if (!known(id)) continue;
    for (const mod of modules) {
      node({ id: `module:${mod}`, kind: "module" });
      edge({ kind: "imports", from: componentNodeId(id), to: `module:${mod}` });
    }
  }

  // assets.css: a local file read for its classes; a URL, or a path to no file, only named.
  for (const sheet of inputs.assetSheets) {
    if (sheet.file === null) {
      node({ id: `stylesheet:${sheet.entry}`, kind: "stylesheet", origin: { project: true }, component: null, source: "external", file: sheet.entry });
    } else {
      const id = `stylesheet:${display(sheet.file)}`;
      node({ id: id as `stylesheet:${string}`, kind: "stylesheet", origin: { project: true }, component: null, source: "asset", file: display(sheet.file) });
      sheetEdges(id, sheet.classes);
    }
  }

  // Templates: the classes they write, their own <style>, the sheets they link.
  for (const [id, hbs] of inputs.templates) {
    if (!known(id)) continue;
    const from = componentNodeId(id);
    for (const name of templateClasses(hbs)) edge({ kind: "borrows", from, to: classNode(name) });
    const entry = discovery.discoveryMap.get(id)!;
    // A data variant writes its base's classes; its base's <style> and links are the base's, not its own.
    if (!entry.ownMarkup) continue;
    const inline = inlineStyleClasses(hbs, entry.hbsPath);
    if (inline) {
      const sheetId = `stylesheet:inline:${id}`;
      node({ id: sheetId as `stylesheet:${string}`, kind: "stylesheet", origin: origin(entry.source), component: id, source: "inline", file: display(entry.hbsPath) });
      edge({ kind: "styled-by", from, to: sheetId });
      sheetEdges(sheetId, inline);
    }
    for (const href of linkedStylesheets(hbs)) {
      const sheetId = `stylesheet:${href}`;
      node({ id: sheetId as `stylesheet:${string}`, kind: "stylesheet", origin: { project: true }, component: null, source: "external", file: href });
      edge({ kind: "styled-by", from, to: sheetId });
    }
  }

  // Requires.
  for (const [id, req] of inputs.requires) {
    if (!known(id)) continue;
    for (const script of req.scripts) {
      node({ id: `asset:script/${script}`, kind: "asset", type: "script" });
      edge({ kind: "requires", from: componentNodeId(id), to: `asset:script/${script}`, key: "requireScript" });
    }
    for (const set of req.assets) {
      node({ id: `asset:svg/${set}`, kind: "asset", type: "svg" });
      edge({ kind: "requires", from: componentNodeId(id), to: `asset:svg/${set}`, key: "requireAssets" });
    }
  }

  // Pages.
  for (const page of inputs.pages) {
    const id = `page:${page.route}` as const;
    node({ id, kind: "page", route: page.route, ...(page.file !== undefined ? { file: page.file } : {}), ...(page.generated ? { generated: page.generated } : {}) });
    if (page.layout && known(page.layout.id)) {
      edge({ kind: "renders", from: id, to: componentNodeId(page.layout.id), source: page.layout.source, ...(page.layout.via !== undefined ? { via: page.layout.via } : {}) });
    }
    for (const p of page.places) if (known(p.id)) edge({ kind: "places", from: id, to: componentNodeId(p.id), how: p.how });
  }

  return index(nodes, [...edges.values()]);
}

/** The adjacency maps over nodes and edges, every list sorted. */
function index(nodeMap: Map<string, GraphNode>, edgeList: GraphEdge[]): ProjectGraph {
  const nodes = new Map([...nodeMap].sort(([a], [b]) => cmp(a, b)));
  const out = new Map<string, GraphEdge[]>();
  const inn = new Map<string, GraphEdge[]>();
  for (const e of edgeList.sort((a, b) => cmp(edgeKey(a), edgeKey(b)))) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e);
  }
  return { nodes, out, in: inn };
}

/** The graph as its JSON: nodes by id, edges by where they start, their kind, then where they end. */
export function graphJson(graph: ProjectGraph): ProjectGraphJson {
  return {
    version: GRAPH_VERSION,
    nodes: [...graph.nodes.values()],
    edges: [...graph.out.values()].flat(),
  };
}
