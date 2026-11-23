// The project graph: one typed graph of components, styles and pages, built by pd dev, pd build, pd audit, pd graph
// and pd mcp from what they already read. Its JSON (`pd graph --json`, `graph.json` in a build) is this shape.
//
// Every node id is its kind and a key (`component:atoms/button`, `page:/guides/setup/`), stable across runs. Paths
// are relative to the project's root with `/`, a package's prefixed with its name, never absolute: the JSON is
// published. Nodes and edges are sorted, so two builds of the same project give the same bytes.

/**
 * The graph's JSON version. Raised for a change a reader must know about (a field or kind removed or renamed); an
 * added field or kind leaves it, and readers ignore what they don't know.
 */
export const GRAPH_VERSION = 1;

/** Where a node comes from: the project, or a pattern package (its npm name). */
export type GraphOrigin = { project: true } | { package: string };

// The kinds and values the graph has, as lists, so a test can ask that a fixture has each one and a new one can't be
// added without it (graph-fixtures.spec.ts). The types below are these lists'.

export const GRAPH_NODE_KINDS = ["component", "variant", "stylesheet", "module", "class", "page", "asset"] as const;
export const GRAPH_EDGE_KINDS = [
  "includes", "variant-of", "styled-by", "defines", "mentions", "borrows", "imports", "renders", "places", "requires",
] as const;
export const COMPONENT_ROLES = ["component", "layout", "partial", "view"] as const;
export const STYLESHEET_SOURCES = ["scss", "css", "asset", "inline", "external"] as const;
export const PLACES_HOW = ["tag", "pattern", "view", "card"] as const;
export const RENDERS_SOURCES = ["own", "folder", "default", "generated"] as const;

export type ComponentRole = typeof COMPONENT_ROLES[number];

export interface ComponentNode {
  id: `component:${string}`;
  kind: "component";
  /** A layout (layout-index.ts), a component under partials/ or views/, or any other component. */
  role: ComponentRole;
  origin: GraphOrigin;
  /** Its template, or null for a base synthesized from its variants. */
  file: string | null;
  schema: string | null;
  docs: string | null;
}

export interface VariantNode {
  id: `variant:${string}`;
  kind: "variant";
  origin: GraphOrigin;
  /** The base component's id (without `component:`). */
  of: string;
  /** Its own markup (`name~variant.hbs`), or data over the base (`name~variant.json`). */
  form: "markup" | "data";
  file: string;
}

export type StylesheetSource = typeof STYLESHEET_SOURCES[number];

export interface StylesheetNode {
  id: `stylesheet:${string}`;
  kind: "stylesheet";
  origin: GraphOrigin;
  /** The component it belongs to, or null (a shared module, an assets.css file, a remote sheet). */
  component: string | null;
  /** A Sass or CSS file of a styles folder, an `assets.css` file, a template's `<style>`, or a sheet on another host
   *  (an `assets.css` URL, a template's own `<link>`), which is never read. */
  source: StylesheetSource;
  /** Its file, or its URL for an external one; for an inline one, the template. */
  file: string;
}

/** A shared Sass module a component's stylesheet loads, by its path in its styles folder (`base/tokens`), as the
 *  Relationships panel names it. */
export interface ModuleNode {
  id: `module:${string}`;
  kind: "module";
}

export interface ClassNode {
  id: `class:${string}`;
  kind: "class";
  /** The component that owns it (the style index's claim), "base" for a shared module's, or null for a class no
   *  compiled stylesheet names. */
  owner: string | null;
  /** For a class owned by "base": the shared module that authored it (`00-base/tokens`), when one did. */
  module?: string;
}

export interface PageNode {
  id: `page:${string}`;
  kind: "page";
  route: string;
  /** Its file, relative to the pages folder; absent for a page Pattern Dump generated. */
  file?: string;
  generated?: "tag" | "tags" | "category" | "categories";
  /** A generated tag's or category's page: the term's key. */
  term?: string;
}

export interface AssetNode {
  id: `asset:${string}`;
  kind: "asset";
  type: "script" | "svg";
}

export type GraphNode = ComponentNode | VariantNode | StylesheetNode | ModuleNode | ClassNode | PageNode | AssetNode;
export type GraphNodeKind = GraphNode["kind"];
// Each list is exactly its union: a kind in one and not the other fails the typecheck.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const nodeKindsMatch: Same<GraphNodeKind, typeof GRAPH_NODE_KINDS[number]> = true;

interface EdgeBase { from: string; to: string }

/** A template includes a component or variant (`{{> partial}}`). */
export interface IncludesEdge extends EdgeBase { kind: "includes" }
/** A variant of its base component. */
export interface VariantOfEdge extends EdgeBase { kind: "variant-of" }
/** A component's own stylesheet: the one it is named after, its template's `<style>`, or a sheet its template links. */
export interface StyledByEdge extends EdgeBase { kind: "styled-by" }
/** A stylesheet's rule defines a class (a context-free compound), with the first selector that does. */
export interface DefinesEdge extends EdgeBase { kind: "defines"; selector: string }
/** A stylesheet's rule names a class it doesn't define (in context, or in a pseudo-class's argument). */
export interface MentionsEdge extends EdgeBase { kind: "mentions"; selector: string }
/** A template writes a class in its markup. */
export interface BorrowsEdge extends EdgeBase { kind: "borrows" }
/** A component's stylesheet loads a shared module (`@use`, `@forward`, from its entry file). From the component. */
export interface ImportsEdge extends EdgeBase { kind: "imports" }
/** A page renders with a layout: its own `layout:`, a folder's `childLayout` (`via`: that index.md, relative to the
 *  pages folder), the default, or as a generated page. */
export interface RendersEdge extends EdgeBase { kind: "renders"; source: typeof RENDERS_SOURCES[number]; via?: string }
/** A page places a component: a `pd-` tag (a child tag too), a `pattern` fence, its listing's view, or the view's card. */
export interface PlacesEdge extends EdgeBase { kind: "places"; how: typeof PLACES_HOW[number] }
/** A component requires a script or an SVG set (`requireScript`, `requireAssets`). */
export interface RequiresEdge extends EdgeBase { kind: "requires"; key: "requireScript" | "requireAssets" }

export type GraphEdge =
  | IncludesEdge | VariantOfEdge | StyledByEdge | DefinesEdge | MentionsEdge | BorrowsEdge | ImportsEdge
  | RendersEdge | PlacesEdge | RequiresEdge;
export type GraphEdgeKind = GraphEdge["kind"];
const edgeKindsMatch: Same<GraphEdgeKind, typeof GRAPH_EDGE_KINDS[number]> = true;
void nodeKindsMatch; void edgeKindsMatch;

/** The whole graph as JSON: `pd graph --json`, and `graph.json` in a build. */
export interface ProjectGraphJson {
  version: typeof GRAPH_VERSION;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
