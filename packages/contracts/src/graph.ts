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

export const GRAPH_NODE_KINDS = ["component", "variant", "stylesheet", "module", "class", "page", "asset", "property"] as const;
export const GRAPH_EDGE_KINDS = [
  "includes", "variant-of", "styled-by", "defines", "mentions", "borrows", "imports", "renders", "places", "requires",
  "uses-property", "declares",
] as const;
export const COMPONENT_ROLES = ["component", "layout", "partial", "view"] as const;
export const STYLESHEET_SOURCES = ["scss", "css", "asset", "inline", "external", "theme"] as const;
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
  /** The component it belongs to, or null (a shared module, an assets.css file, a theme, a remote sheet). */
  component: string | null;
  /** A Sass or CSS file of a styles folder, an `assets.css` file, a template's `<style>`, a theme (`*.theme.scss`), or
   *  a sheet on another host (an `assets.css` URL, a template's own `<link>`), which is never read. */
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

/** A custom property (`property:--neutralLight`): one a rule reads with var(), or one a stylesheet or theme declares.
 *  Its value is not in the graph: it changes per theme, and the compiled theme has it. */
export interface PropertyNode {
  id: `property:--${string}`;
  kind: "property";
}

export type GraphNode = ComponentNode | VariantNode | StylesheetNode | ModuleNode | ClassNode | PageNode | AssetNode | PropertyNode;
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

/**
 * A rule reads a custom property (`var(--x)`, one in a fallback too), from the class it styles: the class of the
 * selector's rightmost compound that has one (`.card > div` styles inside `.card`). From the stylesheet for a rule
 * with no class (`:root`, `body`). `context`: the rule styles the class only inside another one (`.tile .card`), and
 * `within` names the classes before it; a class can have both an own use and uses in context of one property. The
 * first selector that reads it. Read from the compiled CSS, so a var() a mixin or a Sass variable writes counts.
 */
export interface UsesPropertyEdge extends EdgeBase { kind: "uses-property"; selector: string; context: boolean; within?: string[] }
/** A stylesheet or theme declares a custom property (`--x: ...` in any rule, or `@property --x`), with the first
 *  selector that does and the at-rule it sits in (as css-tokens.ts reads it: none, `@media (prefers-color-scheme:
 *  dark)`, `@supports`, or another). */
export interface DeclaresEdge extends EdgeBase { kind: "declares"; selector: string; context: "plain" | "media-dark" | "supports" | "other" }

export type GraphEdge =
  | IncludesEdge | VariantOfEdge | StyledByEdge | DefinesEdge | MentionsEdge | BorrowsEdge | ImportsEdge
  | RendersEdge | PlacesEdge | RequiresEdge | UsesPropertyEdge | DeclaresEdge;
export type GraphEdgeKind = GraphEdge["kind"];
const edgeKindsMatch: Same<GraphEdgeKind, typeof GRAPH_EDGE_KINDS[number]> = true;
void nodeKindsMatch; void edgeKindsMatch;

/** The whole graph as JSON: `pd graph --json`, and `graph.json` in a build. */
export interface ProjectGraphJson {
  version: typeof GRAPH_VERSION;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---- Answers ----
// What `pd describe`, `pd affected` and the MCP tools of the same names answer (graph/answers.ts). Each carries the
// graph's version and the id it answers for. Ids are discovery ids (`atoms/button`, `atoms/button~icon`), pages by
// route, files root-relative as the graph names them.

/** One step of a path through the graph, from the id asked about outwards. */
export interface GraphStep { from: string; kind: GraphEdgeKind; to: string }

/** `contract`: what a component accepts. */
export interface ContractAnswer {
  version: typeof GRAPH_VERSION;
  id: string;
  role: ComponentRole | "variant";
  origin: GraphOrigin;
  file: string | null;
  /** Its JSON Schema, as written, or null without one (or one that doesn't parse: `schemaError`). */
  schema: unknown;
  schemaError?: string;
  variants: Array<{ id: string; form: "markup" | "data" }>;
  /** Its docs, the `.md` text without its frontmatter, or null. */
  docs: string | null;
}

/** `usage`: where a component appears. Components that include it directly; every page that places it or renders
 *  with it, directly or `through` a component that includes it (at any depth). */
export interface UsageAnswer {
  version: typeof GRAPH_VERSION;
  id: string;
  components: string[];
  pages: Array<{ route: string; how: PlacesEdge["how"] | "renders"; through?: string }>;
}

/** `ownership`: which stylesheets style a component, and whose classes it shares. */
export interface OwnershipAnswer {
  version: typeof GRAPH_VERSION;
  id: string;
  stylesheets: Array<{ file: string; source: StylesheetSource }>;
  /** The classes its own stylesheets define, and the ones the style index gives it. */
  defines: string[];
  importsModules: string[];
  /** Other components whose classes its stylesheets style in context, and the reverse. */
  stylesClassesOf: Array<{ component: string; stylesheet: string; classes: Array<{ name: string; selector: string }> }>;
  classesStyledBy: Array<{ component: string; stylesheet: string; classes: Array<{ name: string; selector: string }> }>;
  /** Classes its template writes that another component owns, by owner (included or not). */
  borrows: Array<{ owner: string; classes: string[] }>;
  /** Classes its template writes that no stylesheet defines. */
  unowned: string[];
}

/** `blast_radius`: what breaks if a component changes, each with the path from it. */
export interface BlastRadiusAnswer {
  version: typeof GRAPH_VERSION;
  id: string;
  components: Array<{ id: string; path: GraphStep[] }>;
  stylesheets: Array<{ file: string; path: GraphStep[] }>;
  pages: Array<{ route: string; path: GraphStep[] }>;
}

/** `affected`: everything a change reaches, flat: the list to check before handing over. */
export interface AffectedAnswer {
  version: typeof GRAPH_VERSION;
  /** What was asked about, as the graph names it; `unknown` for what it doesn't know. */
  changed: string[];
  unknown: string[];
  components: string[];
  pages: string[];
}

/** `pd describe <id> --json`: the four answers for one component, each the tool's answer of that name. */
export interface DescribeAnswer {
  version: typeof GRAPH_VERSION;
  id: string;
  contract: ContractAnswer;
  usage: UsageAnswer;
  ownership: OwnershipAnswer;
  blastRadius: BlastRadiusAnswer;
}
