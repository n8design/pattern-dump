// @pattern-dump/contracts
// The seams between packages. Packages build against these, not against each other's internals.
// Behaviour is specified here in prose so an implementer does not have to infer it.
//
// Dev-server ↔ dev-ui protocol lives in dev-protocol.ts (re-exported below).
// Renderer-core types (Render, RenderInput, …) live here.

// ---- Component model (renderer-internal types) ----
export type Visibility = "public" | "private";
export type Status = "draft" | "stable" | "deprecated";

/** Flat partial reference used in templates: `<category>-<name>`, e.g. "atoms-button". */
export type FlatPartialName = string;

export interface ComponentRef {
  id: string;          // path under patterns/, e.g. "molecules/field/input"
  category: string;    // first segment only; depth never changes it
  /** Informational lineage only — no longer an addressing boundary. Nesting records ownership. */
  visibility?: Visibility;
  path: string;
}

// ---- render() contract ----
export interface RenderInput {
  /** Component id (path under patternsDir), e.g. "atoms/button" or "molecules/field". */
  component: string;
  /** Name of a `<component>~<variant>.json` data set. Omitted => base (component.json). */
  variant?: string;
  /** Live-control overrides; highest precedence in the cascade. */
  data?: Record<string, unknown>;
}

export interface RenderMeta {
  componentId: string;
  variant?: string;
  // a11y field removed in M4.11 — rendered findings are client-side only (axe in iframe).
  /** Schema-alignment diagnostics (M4.9); present only when component.schema.json is provided. */
  diagnostics?: import("./dev-protocol").Diagnostic[];
}

export interface RenderOutput {
  /** The rendered component fragment (no document chrome). */
  html: string;
  /**
   * Standalone source document the preview iframe points at:
   * themeable tokens as `:root`/`[data-theme]` custom properties + compiled CSS + the fragment.
   * Same isolation model for docs examples.
   */
  document: string;
  meta?: RenderMeta;
}

/**
 * {{id 'name'}} — ambient, named, deterministic, base-seeded accessibility id helper.
 *
 * BASE-SEEDED SCOPE:
 *   Every render scope has a BASE. `{{id 'name'}}` = `<base>-<name>` (deterministic derivation).
 *   The base is either minted automatically or supplied by a composing parent.
 *
 *   - Minted base: when no base is supplied, the renderer derives the base from the component
 *     slug + composition position. The minted base for the main (top-level) component is
 *     `pd-<component-slug>`. For composed instances, the minting rule ensures per-instance
 *     distinctness (see COMPOSITION RULE below).
 *
 *   - Supplied base: a composing parent may pass `base="<value>"` as a Handlebars partial
 *     hash arg — `{{> molecules-field base="email"}}` — to seed the child's entire id cluster.
 *     Every `{{id 'name'}}` in that subtree then yields `<supplied-base>-<name>`, making the
 *     cluster externally predictable (e.g. `email-input`, `email-hint`).
 *
 * COMPOSITION RULE (minted base, auto-distinct instances):
 *   When the same partial is composed multiple times within one render tree, the FIRST
 *   invocation with a given parent base inherits that parent base (base propagation —
 *   ensures sub-components share the cluster base). Each SUBSEQUENT invocation with the
 *   same parent base mints a new base (`pd-<partial-slug>-<N>`), disambiguating independent
 *   instances without hand-numbering. Template authors never write `-2`; composition
 *   position drives the distinction automatically.
 *
 * BASE PROPAGATION THROUGH COMPOSITION:
 *   When `field` composes `input`, both share the same base (field propagates its base to
 *   input). `{{id 'input'}}` in `field.hbs` and `id="{{id 'input'}}"` in `input.hbs`
 *   resolve to the SAME id — the cluster spans partial boundaries coherently.
 *
 * SCOPE RULES SUMMARY:
 *   1. Same name, same scope → same id (wires label `for` ↔ input `id`).
 *   2. Different name → different id (`hint` ≠ `input`).
 *   3. Different instance → different base → distinct ids for the same name.
 *   4. Supplied base seeds the whole cluster; every member is base + name.
 *   5. Base propagates to composed children (sub-components share the cluster base).
 *   6. Deterministic: same render() input → byte-identical ids and html.
 *   7. Ambient: templates write `{{id 'name'}}` only; no per-element id threading by arg.
 *      The ONLY thing a parent may pass is the BASE for the child's scope.
 *
 * OPEN DECISION — all-states-in-one-document seeding:
 *   Two independent top-level render() calls for the same component produce the same minted
 *   base and therefore the same ids. When the dev environment renders ALL states/instances
 *   into one document (snapshot mode, multi-instance preview), id collisions occur.
 *   Options:
 *     A. Caller supplies RenderInput.seed (recommended): keeps render() pure; dev-env manages
 *        distinct seeds per instance. The seed is incorporated into the minted base.
 *     B. Renderer-managed counter: breaks render() purity (counter leaks across calls).
 *   Current state: `RenderInput.seed` field is defined but unused by the renderer.
 *   Resolve before the dev-environment renders multiple instances in one document.
 */
export type IdHelperSemantics = never; // documentation-only type; not instantiated

/**
 * Pure render. Deterministic: same input => byte-identical output.
 *
 * DATA CASCADE (lowest → highest precedence), per-key deep merge:
 *   1. defaults  — component.json (optional; absent = empty object contributes nothing)
 *   2. composed  — context passed by a parent under a routing key via section descent
 *                  ({{#routingKey}}{{> flat-name}}{{/routingKey}} → child receives routingKey subtree)
 *   3. variant   — <component>~<variant>.json (optional; merges only the keys it declares)
 *   4. live      — input.data (optional; the M3 live-controls seam)
 *
 * MERGE SEMANTICS (per key, applied at each level):
 *   - Object values: merged recursively (deep merge, not whole-object replace).
 *   - Scalar values: replace (string, number, boolean, null).
 *   - Arrays: REPLACE — `["c"]` replaces `["a","b"]`, no concatenation.
 *     ↳ OPEN DECISION: replace vs concat — settle before M3 controls ship.
 *   - null: CLEARS the inherited value (target key becomes null).
 *     ↳ OPEN DECISION: clear vs "inherit from defaults" — settle before M3 controls ship.
 *
 * PARTIAL RESOLUTION (flat naming model):
 *   - Templates reference partials by flat `<category>-<name>` (e.g. {{> molecules-input}}).
 *   - `render({ component })` and graph node ids remain full paths (e.g. "molecules/field/input").
 *   - The renderer builds a registry mapping FlatPartialName → full path before each render.
 *   - A collision (two components → same handle) quarantines the newcomer and surfaces a
 *     HANDLE_COLLISION diagnostic (see CollisionEntry).
 *   - Nesting records informational ownership (lineage); it is NOT an addressing boundary.
 *   The graph's `uses` edges are derived from these partial references (one source of truth).
 */
export type Render = (input: RenderInput) => Promise<RenderOutput>;

export interface RendererOptions {
  /** Root containing the atomic pattern folders (atoms/, molecules/, ...). */
  patternsDir: string;
  /** Every patterns folder, project first, when pattern packages are in use. Takes precedence over
   *  `patternsDir` for discovery. */
  patternRoots?: PatternRoot[];
  /** Theme files directory (custom-property value-sets). Optional for M0. */
  themesDir?: string;
  /** Default theme name applied via `data-theme` on the preview body. */
  defaultTheme?: string;
  /**
   * Pre-loaded project-specific Handlebars helpers, keyed by name.
   * Registered after the core helpers; project helpers may override core ones.
   * Typical flow: core loads `PatternDumpConfig.helpers` path, imports the module, passes here.
   */
  helpers?: Record<string, (...args: unknown[]) => unknown>;
  /**
   * Project-level global data (e.g. hTWOo's `src/_data/`), merged BENEATH component data — the
   * lowest tier of the render cascade: global → defaults → variant → live. Component data wins on
   * every key. Loaded once by the dev-server from `PatternDumpConfig.dataDir`.
   */
  globalData?: Record<string, unknown>;
  /**
   * Project helper *registrars* — modules that self-register onto the render env, the PatternLab
   * shape `module.exports = (Handlebars) => { Handlebars.registerHelper(...) }`. Invoked with the
   * renderer's Handlebars env AFTER partials are registered, so helpers that read
   * `Handlebars.partials` / `.compile` at CALL time (e.g. `dynamicPartial`) resolve against the real
   * env — which a flat name→fn map (`helpers`) cannot express. Registered after core + `helpers`.
   */
  helperRegistrars?: Array<(handlebars: unknown) => void>;
  /**
   * M6: pre-built handle → slash-id map from the dev-server's discovery pass.
   * When provided together with discoveryMap, the renderer uses these maps to register
   * Handlebars partials and resolve file paths without running its own discovery walk.
   * Marked for extraction to a shared discovery module in the refactor round.
   */
  handleMap?: HandleMap;
  /**
   * M6: pre-built id → DiscoveryEntry map from the dev-server's discovery pass.
   * Provides the file paths (hbsPath, jsonPath, schemaPath) used by render().
   * When absent, the renderer calls buildDiscoveryMap(patternsDir) from @pattern-dump/discovery —
   * the real M6 file-as-component walk, never the old collectComponents folder-per-component walk.
   */
  discoveryMap?: DiscoveryMap;
}

/** Factory: a configured renderer closes over its source root, keeping `render()` pure. */
export type CreateRenderer = (options: RendererOptions) => Render;

// ---- M6: file-as-component discovery map ----

/**
 * Single source of truth for where each component's files live.
 * Populated by buildDiscoveryMap; every file-read site uses this map — none reconstruct paths.
 *
 * Collapse rule: `<dir>/<dir>.hbs` → id = `<dir>` (folder-per-component collapses).
 * Otherwise id = relative stem, intermediate group folders retained.
 *
 * For base-less variant synthesis: ownMarkup=false, hbsPath is empty string (no base file),
 * variants lists the variant tokens present on disk.
 */
export interface DiscoveryEntry {
  /** The pattern package this component comes from (its npm name); absent for the project's own. */
  source?: string;
  hbsPath: string;        // absolute path to the .hbs file (empty string for synthesized base nodes)
  jsonPath?: string;      // sidecar <stem>.json (data defaults)
  mdPath?: string;        // sidecar <stem>.md (frontmatter + docs)
  schemaPath?: string;    // sidecar <stem>.schema.json (component schema)
  scssPath?: string;      // sidecar <stem>.scss (reserved — not yet wired)
  ownMarkup: boolean;     // false = base-less synthesized base (no base .hbs on disk)
  variants?: string[];    // variant tokens for synthesized base nodes (e.g. ["info","warning"])
}

/** slash id → file entry. The single source of truth for file locations. */
export type DiscoveryMap = Map<string, DiscoveryEntry>;

/**
 * dash handle → slash id.
 * Bridge for Handlebars partial resolution: `{{> atoms-button}}` → `"atoms/button"`.
 * Handles are group-less: intermediate folder segments are dropped, only category + name kept.
 * Variant handles include `~`: `atoms-spinner~small` → `"atoms/loading/spinner~small"`.
 */
export type HandleMap = Map<string, string>;

/** A handle collision detected at discovery time. The incumbent retains the handle. */
export interface CollisionEntry {
  handle: string;
  incumbentId: string;
  incumbentPath: string;
  quarantinedPath: string;
  /** Slash id of the quarantined component (derived from quarantinedPath at discovery time). */
  quarantinedId: string;
}

/** Return value of buildDiscoveryMap. */
export interface DiscoveryResult {
  discoveryMap: DiscoveryMap;
  handleMap: HandleMap;
  collisions: CollisionEntry[];
  /** Reverse index: absolute hbsPath → slash id. Populated for all entries with a real .hbs file. */
  hbsPathToId: Map<string, string>;
  /** quarantined slash id → CollisionEntry. Used by the detail endpoint to surface HANDLE_COLLISION. */
  quarantineMap: Map<string, CollisionEntry>;
  /** A component of an EARLIER source (the project before packages, then packages in order) that
   *  replaced a later source's component with the same handle. Not an error — it is how a project
   *  overrides a library component — so the shadowed one is neither quarantined nor a collision. */
  overrides: OverrideEntry[];
}

export interface OverrideEntry {
  handle: string;
  /** The id that stays, and where it lives. */
  id: string;
  path: string;
  /** The same-handle component that was replaced, and the package it came from. */
  shadowedPath: string;
  shadowedSource: string;
}

// ---- Pattern packages ----

/** One folder of patterns: the project's own, or a pattern package's. */
export interface PatternRoot {
  dir: string;
  /** The package name; absent for the project. */
  source?: string;
  /** Globs relative to `dir` of templates to leave undiscovered. */
  exclude?: string[];
}

/**
 * A pattern package's self-description: the `patternDump` field of its package.json. Every path is
 * relative to the package folder. All fields are optional, so one package can carry patterns and
 * another the styles and themes they need — the second listed as a peerDependency of the first,
 * which PD follows (`@n8d/htwoo-patterns` → `@n8d/htwoo-core`).
 */
export interface PackageManifest {
  /** Folder of Handlebars patterns (the equivalent of `patternsDir`). */
  patterns?: string;
  /** Global template data folder (`dataDir`). */
  data?: string;
  /** Handlebars helper module or folder (`helpers`). */
  helpers?: string;
  /** Asset folders served under /assets/<folder name>/. */
  assets?: string[];
  styles?: {
    dir: string;
    /** Compile only these entries (relative to `dir`). */
    entry?: string | string[];
    /** Base-origin paths of the shared document layer, as in the project config. */
    documentBase?: string[];
  };
  themes?: {
    dir: string;
    default?: string;
    switch?: import("./dev-protocol").ThemeSwitch;
  };
  /** Behaviour script sources (`scriptsDir`). */
  scripts?: string;
  /** Script ids loaded into every preview. */
  globalScripts?: string[];
  /** Globs (relative to `patterns`) of templates the package ships but does not want discovered. */
  exclude?: string[];
}

// ---- Themes endpoint (not in dev-protocol — served by dev-server, consumed by dev-ui) ----
export interface ThemeSummary {
  name: string;
  // group? deferred — no producer this branch; lands non-breaking when grouping is built
  tokens?: Record<string, string | null>;  // keyed by CSS prop (e.g. "--themePrimary"); null = slot undefined
}

// ---- Shell config shapes (defined here; packages/config imports them) ----

/** Brand slot for the left rail, nested under shell.brand in PatternDumpConfig. */
export interface ShellBrandConfig {
  /** Wordmark text. Defaults to "Pattern Dump". */
  title?: string;
  /**
   * Path to a logo image. Replaces the wordmark when set.
   * A monochrome SVG that inherits currentColor is preferred, but note that
   * <img> does NOT inherit currentColor — full currentColor shell theming is a
   * design-tokens milestone concern. { light, dark } renders a <picture> with
   * prefers-color-scheme sources.
   */
  logo?: string | { light: string; dark: string };
  /** Alt text for the logo image. */
  logoAlt?: string;
  /** Optional href; wraps the brand slot in an <a> (History API navigation). */
  href?: string;
}

/** Ordered list of CSS custom-property names used as swatch slots. */
export type SwatchSlots = string[];

// ---- Dev-server ↔ dev-ui protocol ----
// All types: ComponentId, Category, ComponentStatus, VariantRef, ComponentTree,
// ComponentDetail, ComponentSource, previewUrl, renderedSourceUrl, A11yResult,
// HmrMessage, HelloMessage, ContentSwapMessage, ErrorMessage, etc.
export * from "./dev-protocol";
