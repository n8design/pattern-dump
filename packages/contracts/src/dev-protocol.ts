// @pattern-dump/contracts — dev-server ↔ dev-ui protocol
//
// M4 task 0. The single seam between the `dev-server` package (serves) and the
// `apps/dev-ui` app (consumes). dev-ui depends on NOTHING at build time; its only
// contact with the rest of the system is the types below, over HTTP (data API) and
// a socket (HMR). Neither side imports the other's internals.
//
// KISS: this is the alpha surface. It carries what the M4 shell needs and no more.
// Live controls (schema-driven) and the real component graph are later milestones —
// the placeholders below are deliberately thin.

// ─────────────────────────────────────────────────────────────────────────────
// Shared vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/** A component's canonical identity: its path relative to `patterns/`. e.g. "atoms/button". */
export type ComponentId = string;

/** Top-level atomic category — the first path segment. */
export type Category = string; // "atoms" | "molecules" | … — derived, not enumerated here

export type ComponentStatus = "draft" | "stable" | "deprecated";

/**
 * Preview layout mode (M4.2). How the component sits in the stage. The preview document is the same
 * in both — the markup directly in <body>, no wrapper — only the frame around it differs:
 *  - "centered": the frame is sized to what the content needs (pd-width, measured at the full width
 *                available) and to its height (pd-height), and the stage centres it (atoms/molecules/organisms)
 *  - "full":     the frame fills the stage width AND height, top-aligned (pages/templates, with or
 *                without an ordering prefix: `05-pages` counts)
 * This is the RESOLVED mode (category default ← category index.md frontmatter ← component override),
 * so the shell renders directly without re-deriving precedence.
 */
export type LayoutMode = "centered" | "full";

/** A named data set applied over defaults — a state or a documentation example. */
export interface VariantRef {
  /** The `~variant` token, e.g. "secondary", "disabled". Absent = component defaults. */
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data API  (dev-server → dev-ui, request/response over HTTP)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/tree   (M4.3 — recursive)
 * The sidebar navigation tree: a recursive hierarchy reflecting REAL folder depth
 * (category → intermediate group folders → components), e.g. atoms/input/text-input.
 *
 * Sibling order, at every level including the roots — alphabetical unless the docs override it:
 *  1. the parent folder's `index.md` `order:` LIST of child names (`patterns/index.md` for roots)
 *     puts the listed children first, in list order; unknown names are ignored;
 *  2. otherwise a child's own numeric `order:` WEIGHT (a component's `.md`, a group's `index.md`)
 *     sorts ascending, weighted before unweighted;
 *  3. then alphabetical by path segment, numeric-aware (`item2` before `item10`).
 * Only the leading `---` frontmatter block is read. The client renders this order as served.
 */
export interface ComponentTree {
  /** Top-level nodes (atoms, molecules, …), in the sibling order above. */
  roots: TreeNode[];
}

/**
 * One uniform node for every position in the tree. Three real cases fall out of one shape:
 *  - group folder            — kind "group", has children, no component of its own (e.g. "atoms/input")
 *  - leaf component          — kind "component", no children (e.g. "atoms/button")
 *  - component with children — kind "component" + children (e.g. "molecules/field" owning "field/input")
 * Depth is unrestricted; nesting is informational lineage, not an addressing boundary.
 */
export interface TreeNode {
  /** Full path under patterns/ — folder or component:
   *  "atoms" | "atoms/input" | "atoms/input/text-input". */
  path: string;
  /** Display title from frontmatter. Without one, a component falls back to its last path segment
   *  as-is; a group folder to that segment made readable ("quick-links" → "Quick links"). */
  title: string;
  /** "group" = folder with no component of its own; "component" = renderable (may also have children). */
  kind: "group" | "component";
  /** Present when kind === "component". */
  status?: ComponentStatus;
  /** Resolved layout mode; present when kind === "component". */
  layout?: LayoutMode;
  /** Lineage marker. Private components are nested under their owner and hidden by default in the tree. */
  visibility?: "public" | "private";
  /** The pattern package (npm name) this component comes from; absent for the project's own. Present
   *  only on component nodes — a group's source follows from its components. */
  source?: string;
  /** Has an overview page? TRUE for a group/category folder with ≥1 public component anywhere
   *  beneath it — `index.md` is optional. Suppressed by `overviews: false` in config (all folders)
   *  or `overview: false` in the folder's `index.md` (that folder). FALSE for component nodes
   *  (M4.3) — a component's "all variants" gallery is M4.4, a separate concept. */
  hasOverview: boolean;
  /** Sub-folders / sub-components; absent or empty for a leaf. */
  children?: TreeNode[];
}

// ---- Diagnostics (M4.9) ----

export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticKind =
  | "RENDER_ERROR"       // template compile / render failure
  | "UNFILLED_REQUIRED"  // M2 schema guard — required key absent in merged data
  | "SHAPE_MISMATCH"     // M2 schema guard — merged data fails the schema shape
  | "HTML_INVALID"       // fragment-scoped HTML content-model violation (M4.9 finalise)
  | "CASCADE_WARNING"    // array merge / null-clearing (producer = later milestone)
  | "A11Y"               // axe-core node-mode finding (producer = later milestone)
  | "HIGHLIGHT_FALLBACK" // M4.1 fence/Shiki degradation note
  | "HANDLE_COLLISION"   // M6: component quarantined — handle held by incumbent; rename to resolve
  | "DATA_INVALID";      // a component or variant .json that does not parse; its data was not used

/** Fields every diagnostic carries, whichever engine produced it. */
interface DiagnosticBase {
  severity: DiagnosticSeverity;
  message: string;
  /** Rule id within the engine (e.g. html-validate "element-permitted-content"). A11yDiagnostic
   *  sets this to the axe rule id; html-validate sets it to the failing rule; absent for kinds that
   *  have no finer rule than their `kind` (RENDER_ERROR, HANDLE_COLLISION, schema kinds). */
  ruleId?: string;
  /** JSON Schema / data pointer, e.g. "#/properties/label" — schema kinds only. */
  path?: string;
  /** Source-file position — RENDER_ERROR and DATA_INVALID, best-effort. `file` is never an absolute
   *  path: relative to the project root for the project's own files (`src/patterns/atoms/x/x.json`),
   *  `<package name>/<path in the package>` for a pattern package's (`@acme/ds/patterns/atoms/x/x.json`).
   *  Output built anywhere names a file the same way, and names no folder of the machine it ran on. */
  location?: { file?: string; line?: number; column?: number };
}

/** A finding from any engine other than axe. */
export interface GeneralDiagnostic extends DiagnosticBase {
  kind: Exclude<DiagnosticKind, "A11Y">;
  source: "render" | "schema" | "html" | "cascade" | "highlight" | "discovery";
}

/** Per-node axe-core finding. One diagnostic per failing DOM node. */
export interface A11yDiagnostic extends DiagnosticBase {
  kind: "A11Y";
  source: "axe";
  // severity mapped from axe impact, message = failureSummary
  ruleId: string;     // axe violation id, e.g. "color-contrast"
  target: string;     // CSS selector of the failing node (node.target.join(" > "))
  nodeHtml: string;   // the failing HTML snippet (node.html)
  help: string;       // short fix label (violation.help)
  helpUrl: string;    // Deque rule docs (violation.helpUrl)
  /** Populated only when ruleId === "color-contrast". Source: nodes[n].any[0].data. */
  contrast?: { fg: string; bg: string; ratio: number; expected: number };
  /** True when sourced from axe's `incomplete` array — axe could not confirm pass/fail.
   *  Absent/false = confirmed violation. Confirmed and needs-review are distinct certainty levels. */
  needsReview?: boolean;
}

/**
 * Any diagnostic — a union discriminated on `kind` (and equivalently `source`): checking
 * `d.kind === "A11Y"` narrows to A11yDiagnostic, so consumers never cast to reach axe fields.
 */
export type Diagnostic = GeneralDiagnostic | A11yDiagnostic;

// ---- Diagnostics graph ----
// A project-wide, always-derived artifact of every static, machine-detectable defect in a design
// system under PD — the inverse of the per-component `ComponentDetail.diagnostics` panel. It is a
// bipartite graph (rule nodes ↔ component nodes, edges = occurrences). The flat list, rule×count,
// per-component and per-engine tables are all VIEWS over `occurrences` — storage is the graph, never
// a flat list reconstructed into one. Component nodes key on the discovery id — the SAME id
// composition (`uses`) and style (`styleUses`/`styleModules`) use — so the three graphs converge
// later by merge, not a rewrite.

/** The detection engine that produced a finding — a DISTINCT dimension from the rule id. Roll-up by
 *  engine ("all axe", "all html-validation") is a field filter on this, never a string-prefix match. */
export type DiagnosticEngine = "axe" | "html-validate" | "schema" | "render" | "discovery";

/** Provenance tag. `SUBJECT-DEBT` = a real defect in the system under test (the common case; the
 *  subject owns its templates). `PD-GAP` = PD's own detector/pipeline is at fault, not the subject.
 *  Default is always SUBJECT-DEBT; PD-GAP is applied only via an explicit allowlist, never inferred
 *  from a diagnostic kind (a RENDER_ERROR is the subject's template debt by default). */
export type DiagnosticTag = "SUBJECT-DEBT" | "PD-GAP";

/** A component's render outcome — metadata on the node, NEVER itself a defect occurrence. A component
 *  that renders empty for want of project data (data-masked) or a base synthesized from variants is
 *  legitimately `blank`; blank annotates findings (populated rules aren't over-claimed on empty
 *  output) but is not counted as a defect. `error` = the template threw (a real defect, also emitted
 *  as a RENDER_ERROR occurrence). */
export type RenderOutcome = "ok" | "blank" | "error";

/** A rule node. `engine` and `ruleId` are two DISTINCT dimensions, never concatenated into one id. */
export interface RuleNode {
  engine: DiagnosticEngine;
  ruleId: string;
  /** Optional composed label for display only (e.g. "axe:color-contrast"). Not an identity. */
  displayKey?: string;
}

/** A component node — keyed on the discovery id (`collapseComponentId` form). */
export interface DiagnosticComponentNode {
  id: ComponentId;
  render: RenderOutcome;
}

/** An occurrence edge: this rule fired on this component. References the rule by the (engine, ruleId)
 *  pair — the same two distinct dimensions, not a concatenated node id. */
export interface DiagnosticOccurrence {
  engine: DiagnosticEngine;
  ruleId: string;
  component: ComponentId;
  severity: DiagnosticSeverity;
  message: string;
  /** DOM path of the failing node, when the engine provides one (axe target / html-validate selector). */
  domPath?: string;
  tag: DiagnosticTag;
}

/** The project-wide diagnostics graph. Storage IS the graph; all tables are views over `occurrences`. */
export interface DiagnosticsGraph {
  rules: RuleNode[];
  components: DiagnosticComponentNode[];
  occurrences: DiagnosticOccurrence[];
  /** ISO timestamp stamped by the caller after the pure build returns (build has no clock access). */
  generatedAt?: string;
  /** The subject's commit SHA when it has one (pinned in the report). */
  subjectSha?: string;
}

// ---- Audit rollup (the `pd audit` view model — shared by the CLI report renderers AND the
//      Phase-2 workbench audit facet). Lives here, not in dev-server, so both sides of the
//      browser/server seam render from ONE builder (`buildAuditRollup`) — a tool whose thesis is
//      "derived views can't go stale" cannot have two implementations of its own rollup. ----

/** One line of the audit scope: a named area and what it means. */
export interface AuditScopeItem {
  name: string;
  detail: string;
}

/** What the corpus audit checks and what it deliberately leaves out. Carried with every audit result
 *  (every `pd audit` format and the workbench's Audit tab), because a defect count is only meaningful
 *  next to its limits. Data, not formatted text: each renderer (Markdown, plain text, JSON, the
 *  workbench's DOM) formats it for its own medium. */
export interface AuditScope {
  covered: AuditScopeItem[];
  notCovered: AuditScopeItem[];
  /** The closing statement on what zero findings means. */
  note: string;
}

export const AUDIT_SCOPE: AuditScope = {
  covered: [
    { name: "HTML content model", detail: "invalid nesting and content that isn't permitted where it appears (html-validate)." },
    { name: "Structural accessibility", detail: "labels, accessible names, ARIA attributes, roles and image alternatives (the axe-core rules that don't need layout)." },
    { name: "Schema", detail: "missing required fields and values of the wrong type, checked against each component's `<name>.schema.json`." },
    { name: "Render outcome", detail: "whether each component rendered, rendered empty or failed. It is reported with the component, not counted as a defect." },
  ],
  notCovered: [
    { name: "Checks that need a rendered page", detail: "colour contrast, focusable content hidden with aria-hidden, and duplicate ids referenced by ARIA. They need real browser layout; the Console's Diagnostics tab runs them for the component on screen." },
    { name: "Interaction", detail: "focus traps, keyboard flow and Escape handling. The audit looks at a single static render." },
    { name: "Structure", detail: "unused components, shared bases and near-duplicate copies. The Relationships tab and `pd export` cover those." },
    { name: "Components that need data", detail: "a component that renders empty without data can't show the problems it would have with data. Its findings carry the render outcome." },
  ],
  note: "No findings means no static, machine-detectable defects, not that a component is fully accessible or correct.",
};

/** Per-rule roll-up: blast radius (distinct components) primary, occurrences secondary. */
export interface AuditRuleRollup {
  engine: string; ruleId: string; components: number; occurrences: number; tags: string[];
}
export interface AuditComponentRollup {
  id: string; render: RenderOutcome;
  occurrences: Array<{ engine: string; ruleId: string; tag: DiagnosticTag; message: string; domPath?: string }>;
}
/** The `pd audit` report as structured data — the single rollup every output format serializes.
 *  All roll-ups (headline numbers, rule blast-radius table, per-component list) are computed ONCE in
 *  `buildAuditRollup`; `md`/`text`/`json` (and the workbench facet) are renderers over this object,
 *  never independent string builders. A CI consumer reading the `json` gets `scope` (what the audit covers)
 *  and `headline` alongside the count, never a bare number. */
export interface AuditRollup {
  subjectSha?: string;
  /** The headline sentence, plain (no markdown emphasis); renderers wrap/position it. */
  headline: string;
  totals: { components: number; affected: number; cleanPct: number; defects: number };
  renderOutcomes: { ok: number; blank: number; error: number };
  rulesByBlast: AuditRuleRollup[];
  perComponent: AuditComponentRollup[];
  /** What the audit covers and leaves out (AUDIT_SCOPE). Carried in every format. */
  scope: AuditScope;
}

/** Build the structured rollup from the graph — the numbers exist as data here, not only as strings.
 *  PURE: same graph → same rollup, no I/O or clock. The one builder both the CLI report renderers and
 *  the workbench audit facet call. */
export function buildAuditRollup(graph: DiagnosticsGraph, opts: { subjectSha?: string } = {}): AuditRollup {
  const total = graph.components.length;
  const affected = new Set(graph.occurrences.map(o => o.component));
  const cleanPct = total > 0 ? Math.round((100 * (total - affected.size)) / total) : 100;
  const outcomes = graph.components.reduce<Record<string, number>>((a, c) => { a[c.render] = (a[c.render] ?? 0) + 1; return a; }, {});

  // Per-rule roll-up: blast radius (distinct components) primary, occurrences secondary.
  const perRule = new Map<string, { engine: string; ruleId: string; occ: number; comps: Set<string>; tags: Set<string> }>();
  for (const o of graph.occurrences) {
    const k = `${o.engine} ${o.ruleId}`;
    const r = perRule.get(k) ?? { engine: o.engine, ruleId: o.ruleId, occ: 0, comps: new Set(), tags: new Set() };
    r.occ += 1; r.comps.add(o.component); r.tags.add(o.tag); perRule.set(k, r);
  }
  const rulesByBlast: AuditRuleRollup[] = [...perRule.values()]
    .sort((a, b) => b.comps.size - a.comps.size || b.occ - a.occ || `${a.engine}:${a.ruleId}`.localeCompare(`${b.engine}:${b.ruleId}`))
    .map(r => ({ engine: r.engine, ruleId: r.ruleId, components: r.comps.size, occurrences: r.occ, tags: [...r.tags].sort() }));

  const occByComp = new Map<string, DiagnosticOccurrence[]>();
  for (const o of graph.occurrences) { const a = occByComp.get(o.component) ?? []; a.push(o); occByComp.set(o.component, a); }
  const perComponent: AuditComponentRollup[] = [];
  for (const c of graph.components) {
    const occ = occByComp.get(c.id) ?? [];
    if (occ.length === 0 && c.render === "ok") continue; // list only components with findings or a non-ok render
    perComponent.push({
      id: c.id,
      render: c.render,
      occurrences: [...occ]
        .sort((a, b) => `${a.engine}:${a.ruleId}`.localeCompare(`${b.engine}:${b.ruleId}`))
        .map(o => ({ engine: o.engine, ruleId: o.ruleId, tag: o.tag, message: o.message, ...(o.domPath ? { domPath: o.domPath } : {}) })),
    });
  }

  return {
    ...(opts.subjectSha ? { subjectSha: opts.subjectSha } : {}),
    headline: `${graph.occurrences.length} machine-detectable static defects across ${affected.size} of ${total} components — ${cleanPct}% clean of static machine-detectable defects.`,
    totals: { components: total, affected: affected.size, cleanPct, defects: graph.occurrences.length },
    renderOutcomes: { ok: outcomes["ok"] ?? 0, blank: outcomes["blank"] ?? 0, error: outcomes["error"] ?? 0 },
    rulesByBlast,
    perComponent,
    scope: AUDIT_SCOPE,
  };
}

/**
 * GET /api/version
 * Build identity of the running dev server, so a human or script (scripts/check-server-fresh.mjs)
 * can tell whether the process answering is behind the artifacts on disk. Frozen at boot.
 */
export interface VersionInfo {
  /** Wall-clock start, ISO-8601. */
  startedAt: string;
  /** mtime (ms) of the dev-server bundle this process actually loaded, read at startup. */
  serverBundleMtime: number | null;
  /** PD_PROTOCOL_VERSION the server was built with. */
  protocol: number;
}

/**
 * GET /api/component/:id
 * Everything the panel + preview need for one component. The shell never reads the
 * filesystem — this is the whole picture.
 */
export interface ComponentDetail {
  id: ComponentId;
  title: string;
  description: string;
  category: Category;
  status: ComponentStatus;
  /** If status === "deprecated". */
  deprecatedUse?: string;

  /** Resolved preview layout mode (M4.2) — see LayoutMode. Always present (a default always applies). */
  layout: LayoutMode;

  /**
   * Full preview HTML document for the default variant, ready to assign directly to
   * `iframe.srcdoc`. Non-default variants are fetched on demand via `previewUrl()`.
   * Root-relative asset links (`/_pd/*.css`, `/assets/...`) resolve because an unsandboxed
   * srcdoc iframe inherits the parent origin; the static build will supply a `<base href>`
   * via `buildPreviewDocument`'s `baseHref` parameter instead.
   *
   * Always present in live dev-server responses. Optional in the type because
   * `buildComponentDetail` returns the rest of the detail without it — the HTTP handler
   * computes and appends it before sending the JSON payload.
   */
  document?: string;

  /** Switchable variants for the toolbar. The default (no variant) is always available implicitly. */
  variants: VariantRef[];

  /** Source files, for the source tab's HBS/HTML toggle and any future viewers. */
  source: ComponentSource;

  /** Rendered markdown documentation for the docs tab. Absent if no `.md`.
   *  M4.1: fenced code blocks inside are Shiki-highlighted at render time (class-based HTML);
   *  `pattern` embed blocks are NOT highlighted — they render the real component via render(). */
  doc?: string;

  /**
   * Composition-aggregated behaviour script ids and CDN URLs from `requireScript` frontmatter.
   * Bare ids are served at /_pd/scripts/<id>.js (ESbuild-compiled from scriptsDir).
   * Absolute URLs (contain `://`) are CDN refs injected as-is.
   * Deduped, preserving declaration order. Absent when none declared in the component tree.
   */
  requireScripts?: string[];

  /**
   * Composition-aggregated SVG symbol set ids from `requireAssets` frontmatter.
   * Each id resolves to a symbol set SVG in the project assets dir, inlined hidden at the top
   * of the preview body to enable same-document `<use href="#id">` with currentColor inheritance.
   * Deduped. Absent when none declared.
   */
  requireAssets?: string[];

  /** Composition + style relationships for this component (M5). Discriminated on `available`. */
  relationships: Relationships;

  /** Per-render diagnostics for the selected component + variant (M4.9). Empty = clean render. */
  diagnostics: Diagnostic[];
}

export interface ComponentSource {
  /** Raw Handlebars template text. Always present (`.hbs` is the only required file).
   *  Raw is the copy source of truth — the copy button copies this, never the highlighted markup. */
  hbs: string;
  /** Render-time Shiki-highlighted HBS as class-based HTML (M4.1). For display in the source tab. */
  hbsHighlighted: string;
  /** Raw default-variant data, if a `component.json` exists (optional per M2).
   *  Per-variant data comes via `dataSourceUrl` (not carried in the payload). */
  json?: string;
  /** Highlighted JSON, present whenever `json` is. */
  jsonHighlighted?: string;
  /** Raw `component.schema.json`, if the file exists. Component-level; does not vary with variant. */
  schema?: string;
  /** Shiki-highlighted schema JSON. Present whenever `schema` is. */
  schemaHighlighted?: string;
  /** Raw markdown source, if present. (Highlighted fenced blocks live in the RENDERED doc — the
   *  `doc` field on ComponentDetail — not here; this is the raw `.md` for reference/copy.) */
  md?: string;
}

/**
 * The relationships facet payload (M5) — two layers of edges:
 *   - composition (template): uses / usedBy — from the flat-partial registry.
 * Three DISTINCT style relationships — kept separable in the graph, do not conflate:
 *   - style (component class-borrowing): styleUses — components whose CSS classes appear in this
 *       component's own markup (.hbs), attributed via a class→owner index built from compiled
 *       CSS source maps. styleUsedBy is intentionally omitted (it's the transpose of every
 *       component's styleUses; recompute on demand for impact analysis).
 *   - style (@use dependency): styleUsesModules — shared base/token/mixin modules this component's
 *       SCSS @use/@forward-imports. This is a SCSS dependency, not a worn class. Convention:
 *       components must not @use another component's SCSS; if violated the target degrades to a
 *       plain module path here (non-navigable).
 *   - style (module class-borrowing): styleModules — shared/family modules that AUTHOR a class worn
 *       by this component's markup but belong to no component (the module-level analog of styleUses).
 *       These are the classes that would otherwise vanish into the base layer unattributed.
 *   - style (leftovers): inlineStyles, utilityClasses, unattributedClasses — honest accounting
 *       for classes that don't map to a known component or module.
 *
 * Determinism: arrays are sorted and deduplicated — byte-identical for an unchanged tree.
 */
/** A shared SCSS module that belongs to no component (e.g. "00-base/tokens"). Non-navigable. */
export type StyleModuleId = string;

export interface RelationshipsAvailable {
  /** Always true. The "not yet computed" placeholder arm this once discriminated was never produced
   *  and has been removed; the flag stays so existing payload readers keep working. */
  available: true;
  /** Components this one includes via template partials (composition). */
  uses: ComponentId[];
  /** Components that include this one (inverse composition). */
  usedBy: ComponentId[];
  /** Components whose CSS classes appear in this component's own markup (class-borrowing). */
  styleUses: ComponentId[];
  // styleUsedBy intentionally omitted — transpose of every component's styleUses.
  /** Shared SCSS modules this component's SCSS @use/@forward-imports — a dependency, not a worn
   *  class (non-navigable). */
  styleUsesModules: StyleModuleId[];
  /** Shared/family modules that authored a class worn by this component's markup but belong to no
   *  component — the module-level analog of styleUses (non-navigable). */
  styleModules: StyleModuleId[];
  /** True if markup contains style="" attributes or inline <style> blocks. */
  inlineStyles: boolean;
  /** True if any used class is owned by a registered utility source (e.g. Tailwind). */
  utilityClasses: boolean;
  /** CSS classes used in markup whose ownership is unrecognised (typos, dead, unregistered). */
  unattributedClasses: string[];
}

export type Relationships = RelationshipsAvailable;

/**
 * GET /api/overview/:path   (M4.3 — was /api/category/:cat in M4.2)
 * The overview page for a FOLDER — a top-level category ("atoms") or an intermediate group
 * ("atoms/input"). The `index.md` (if any) plus the ordered list of the PUBLIC components in that
 * folder's subtree, for the "show me all of these" gallery. Each item renders as its real component
 * in its own isolated preview (via previewUrl), so the gallery is a list of <figure> illustrations.
 *
 * `index.md` is optional: with none, `doc` is absent and the gallery is auto-generated from
 * `components` using the folder's default layout. Component nodes do NOT get a folder overview
 * (their "all variants" gallery is M4.4); overviews belong to group/category folders.
 */
export interface FolderOverview {
  /** Folder path — "atoms" or "atoms/input". */
  path: string;
  /** Rendered `index.md` body, if the folder has one (M4.1 highlighting applies to its fences). */
  doc?: string;
  /** Resolved layout mode for this folder's previews (component overrides still win per item). */
  layout: LayoutMode;
  /** The public components in this folder's subtree, in tree order (pre-order, siblings as in
   *  ComponentTree) — the same order the Nav Rail shows. Each rendered live. */
  components: FolderOverviewItem[];
}

export interface FolderOverviewItem {
  id: ComponentId;
  /** The pattern package this component comes from; absent for the project's own. */
  source?: string;
  title: string;
  status: ComponentStatus;
  /** Per-item resolved layout (usually the folder default; a component may override). */
  layout: LayoutMode;
}

/**
 * Returns the URL for a component's standalone preview document.
 *
 * Used for:
 *   - On-demand fetch of non-default variant documents (`fetch(previewUrl(id, v)).then(r=>r.text())`)
 *   - HMR content-swap re-fetch
 *   - Open-in-new-tab links
 *
 * The single-preview iframe is driven by `srcdoc`, NOT `src` — this URL is never assigned
 * to `iframe.src`. Keeping the route active for the use cases above.
 *
 * `theme` bakes `data-theme` into the served `<body>` pre-paint, fixing the one-frame flash
 * on non-default themes. Pass the current user theme so the iframe renders correctly without
 * waiting for the `iframe.load` handler. An empty string or absent value uses the config default.
 *
 * GET /preview/:id                       → default-data, config-default theme
 * GET /preview/:id?variant=x             → variant document
 * GET /preview/:id?theme=dark            → config-default variant, dark theme pre-baked
 * GET /preview/:id?variant=x&theme=dark  → variant + theme
 */
export function previewUrl(id: ComponentId, variant?: string, theme?: string): string {
  const params = new URLSearchParams();
  if (variant) params.set("variant", variant);
  if (theme)   params.set("theme", theme);
  const q = params.toString() ? `?${params.toString()}` : "";
  return `${PD_ROUTE_PREFIX.preview}${id}${q}`;
}

/**
 * The source tab's "rendered HTML" view (M4.1 — DECIDED).
 *
 * The rendered HTML is per-variant and HMR-volatile (it changes on every `content-swap`),
 * so — unlike the static `.hbs`/`.json` source, which rides in ComponentSource — it is NOT
 * carried in the once-fetched ComponentDetail. The shell fetches the Shiki-highlighted
 * rendered fragment by URL, lazily, only when this view is selected, and re-fetches on a
 * `content-swap` for the current variant. This mirrors the per-variant `previewUrl` model.
 *
 * GET /source/:id/rendered            → highlighted rendered HTML for default data
 * GET /source/:id/rendered?variant=x  → highlighted rendered HTML for a variant
 *
 * Returns class-based highlighted HTML (same Shiki stylesheet as ComponentSource.*Highlighted).
 * There is deliberately no `htmlHighlighted` field on ComponentSource.
 */
export function renderedSourceUrl(id: ComponentId, variant?: string): string {
  const q = variant ? `?variant=${encodeURIComponent(variant)}` : "";
  return `${PD_ROUTE_PREFIX.source}${id}/rendered${q}`;
}

/**
 * The data file for a component selection (JSON tab, M4.6).
 *
 * Per-variant data is HMR-volatile (it changes when the variant file changes), so it is NOT
 * carried in the once-fetched ComponentDetail. The shell fetches the Shiki-highlighted data
 * fragment lazily (only when the JSON tab is selected) and re-fetches on a `content-swap`.
 * The default-variant data is also available via this route for consistency.
 *
 * GET /source/:id/data            → highlighted default data (component.json)
 * GET /source/:id/data?variant=x  → highlighted variant data (component~x.json)
 *
 * Returns class-based highlighted HTML (same Shiki stylesheet as ComponentSource.*Highlighted).
 */
export function dataSourceUrl(id: ComponentId, variant?: string): string {
  const q = variant ? `?variant=${encodeURIComponent(variant)}` : "";
  return `${PD_ROUTE_PREFIX.source}${id}/data${q}`;
}

/**
 * Folder overview route (M4.3). Addressed by folder path, any depth.
 * GET /api/overview/atoms          → top-level category overview
 * GET /api/overview/atoms/input    → intermediate group overview
 */
export function overviewUrl(path: string): string {
  return `${PD_ROUTE_PREFIX.overview}${path}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route table — every dev-server route, and the remaining response shapes
// ─────────────────────────────────────────────────────────────────────────────
//
// The builders above and below are the ONLY way either side spells a URL: dev-ui fetches with them,
// the server emits links with them, and routes.ts matches incoming paths against the same constants.
//
// Component ids are carried RAW in every id route — never encodeURIComponent'd, which would turn the
// "/" separators into %2F — and the server does not decode them. Theme names and script ids are
// single segments, so those two are encoded by the builder and decoded by the server.

/** Fixed-path routes. */
export const PD_ROUTES = {
  /** GET → ComponentTree */
  tree: "/api/tree",
  /** GET → AuditResponse (500 → ApiError) */
  audit: "/api/audit",
  /** GET → ThemeSummary[] */
  themes: "/api/themes",
  /** GET → VersionInfo */
  version: "/api/version",
  /** GET → ShellClientConfig */
  config: "/api/config",
  /** GET → StorefrontPagesResponse, on the storefront host. What `pd build` crawls for storefront pages. */
  pages: "/api/pages",
  /** The shell bundle, stylesheet and vendored assets. */
  mainJs: "/_pd/main.js",
  mainCss: "/_pd/main.css",
  axeCore: "/_pd/axe-core.js",
  /** GET → RuleTiers */
  ruleTiers: "/_pd/rule-tiers.json",
  shikiCss: "/_pd/shiki.css",
  /** Document-base layer (reset + font-face). */
  baseCss: "/_pd/base.css",
} as const;

/**
 * The two front ends of one `pd dev` process, told apart by the request's Host header. Both serve
 * from `/`. Any other host — plain `localhost`, `127.0.0.1` — gets the workbench, as before.
 * `storefront.host` in the config replaces the storefront default.
 */
export const PD_HOSTS = {
  storefront: "live.localhost",
  workbench: "pd.localhost",
} as const;

/** Prefixes of the parameterised routes. routes.ts matches with these; the builders emit them. */
export const PD_ROUTE_PREFIX = {
  component: "/api/component/",
  overview: "/api/overview/",
  preview: "/preview/",
  source: "/source/",
  componentCss: "/_pd/components/",
  themeCss: "/_pd/themes/",
  script: "/_pd/scripts/",
  assets: "/assets/",
} as const;

/**
 * GET /api/component/:id[?variant=x] → ComponentDetailResponse (404 → ApiError).
 * A quarantined or failing component is still 200, carrying its diagnostic.
 */
export function componentUrl(id: ComponentId, variant?: string): string {
  const q = variant ? `?variant=${encodeURIComponent(variant)}` : "";
  return `${PD_ROUTE_PREFIX.component}${id}${q}`;
}

/** Per-component own-origin CSS. `version` is a cache-buster (`?v=`), ignored by the server. */
export function componentCssUrl(id: ComponentId, version?: number | string): string {
  const q = version !== undefined ? `?v=${version}` : "";
  return `${PD_ROUTE_PREFIX.componentCss}${id}.css${q}`;
}

/** Per-theme CSS. 404 when the theme is unknown or no themes dir is configured. */
export function themeCssUrl(name: string): string {
  return `${PD_ROUTE_PREFIX.themeCss}${encodeURIComponent(name)}.css`;
}

/** A compiled behaviour script (esbuild, from scriptsDir). `version` is a cache-buster. */
export function scriptUrl(id: string, version?: number | string): string {
  const q = version !== undefined ? `?v=${version}` : "";
  return `${PD_ROUTE_PREFIX.script}${encodeURIComponent(id)}.js${q}`;
}

/** How the shell switches component themes in the preview: toggle `data-theme` on one set of
 *  linked theme stylesheets, or swap a single theme stylesheet (for bare-`:root` theme sets). */
export type ThemeSwitch = "attribute" | "stylesheet";

/** GET /api/config — the server-declared settings the shell reads once at startup. */
export interface ShellClientConfig {
  /** The project's `shell` config block, or null when it has none. */
  shell: { brand?: import("./index").ShellBrandConfig } | null;
  themeSwitch: ThemeSwitch;
  /** The configured default theme — what an un-themed preview actually shows. "" when none. */
  defaultTheme: string;
}

/** One storefront page: a markdown file in `storefront.pagesDir`, at the route its path defines. */
export interface StorefrontPage {
  /** Root-relative and slash-wrapped: "/" for pages/index.md, "/guides/setup/" for pages/guides/setup.md. */
  route: string;
  /** The page's `title`, or its route when it has none. */
  title: string;
  /** The layout it renders with: the component `layouts/<layout>`. */
  layout: string;
}

/** A nav entry. Top-level pages and folders; a folder's pages are its children (one level only). */
export interface StorefrontNavItem {
  route: string;
  title: string;
  /** The page's `description` from its frontmatter; absent when it has none. */
  description?: string;
  children?: StorefrontNavItem[];
}

/** GET /api/pages — every storefront page and the nav, in nav order. */
export interface StorefrontPagesResponse {
  pages: StorefrontPage[];
  nav: StorefrontNavItem[];
}

/** The body of every JSON error response. */
export interface ApiError {
  error: string;
}

/** GET /api/audit — the diagnostics graph, stamped at response time. */
export interface AuditResponse extends DiagnosticsGraph {
  generatedAt: string;
  /** Surgical HMR re-audits since startup — a debug instrument (rises by exactly 1 per .hbs edit,
   *  0 per .scss edit). Not part of the graph; the leading underscore marks it as diagnostic. */
  _liveReaudits: number;
}

/** GET /_pd/rule-tiers.json — the generated axe rule classification (packages/a11y classifier). */
export interface RuleTiers {
  /** Rules the static (jsdom) sweep runs. */
  alwaysOn: string[];
  /** Rules whose verdict needs real browser layout — run only in the live iframe. */
  needsRendering: string[];
  /** Rules not yet classified. */
  investigate: string[];
  /** Provenance written by the classifier. */
  _note?: string;
  generatedAt?: string;
  axeVersion?: string;
}

/** GET /api/component/:id — the live server always includes the preview document. */
export type ComponentDetailResponse = ComponentDetail & { document: string };

// ─────────────────────────────────────────────────────────────────────────────
// Static build — the snapshot `pd build` writes, and how the shell reads it
// ─────────────────────────────────────────────────────────────────────────────
//
// `pd build` crawls the live routes above and writes each response to a file; the shell, loaded from
// those files, maps every URL it would have fetched to the same file. `staticPathFor` is that ONE
// mapping, shared by the writer and the reader so they cannot disagree. Query strings do not exist on
// a static host, so everything a query carried moves into the path:
//
//   /api/tree                                  → api/tree.json            (also themes, config, version, audit)
//   /api/component/atoms/button                → api/component/atoms/button/index.json
//   /api/component/atoms/button?variant=ghost  → api/component/atoms/button/~ghost.json
//   /api/overview/atoms/input                  → api/overview/atoms/input/index.json
//   /preview/atoms/button?variant=ghost&theme=x → preview/atoms/button/~ghost.html   (theme: see below)
//   /source/atoms/button/rendered?variant=ghost → source/atoms/button/rendered~ghost.html (also data)
//   /_pd/components/atoms/button.css?v=123     → _pd/components/atoms/button.css      (cache-busters dropped)
//   /assets/images/logo.svg                    → assets/images/logo.svg
//   /atoms/button   (a shell route)            → atoms/button/index.html
//
// Previews are built with the project's default theme baked in; `theme` is dropped from the path and
// the shell applies any other theme after load, exactly as it does live.

/** How the shell document was served, inlined as `window.__pd` by whichever side produced it. */
export type ShellRuntime =
  | { mode: "live"; wsPort: number }
  | {
      mode: "static";
      /** Where the snapshot is hosted: "/" at a domain root, or "/sub/path/" (always slash-wrapped). */
      basePath: string;
      /** ISO timestamp of the build. */
      builtAt: string;
      /** The pattern-dump version that built it. */
      pdVersion: string;
      /** false when built without the corpus audit (`pd build --no-audit`): no api/audit.json exists
       *  and the shell offers no Audit tab. Absent means included. */
      audit?: boolean;
    };

/** "/pd", "pd/", "pd" → "/pd/"; "" and "/" → "/". */
export function normalizeBasePath(basePath: string | undefined): string {
  const trimmed = (basePath ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

/** The snapshot file (relative, no leading slash) that holds the response for a live URL.
 *  The result is a URL PATH, still percent-encoded where the live URL was (`brand%20blue.css`): the
 *  shell requests it as-is, a static host decodes it, so the build writes the DECODED name to disk. */
export function staticPathFor(liveUrl: string): string {
  const url = new URL(liveUrl, "http://pd.invalid");
  const path = url.pathname;
  const variant = url.searchParams.get("variant") || undefined;
  const suffix = (ext: string): string => (variant ? `~${variant}${ext}` : `index${ext}`);
  const under = (prefix: string): string => path.slice(prefix.length);

  if (path.startsWith(PD_ROUTE_PREFIX.component)) return `api/component/${under(PD_ROUTE_PREFIX.component)}/${suffix(".json")}`;
  if (path.startsWith(PD_ROUTE_PREFIX.overview)) return `api/overview/${under(PD_ROUTE_PREFIX.overview)}/index.json`;
  if (path.startsWith("/api/")) return `${path.slice(1)}.json`;
  if (path.startsWith(PD_ROUTE_PREFIX.preview)) return `preview/${under(PD_ROUTE_PREFIX.preview)}/${suffix(".html")}`;
  if (path.startsWith(PD_ROUTE_PREFIX.source)) {
    const rest = under(PD_ROUTE_PREFIX.source);
    const facet = rest.endsWith("/rendered") ? "rendered" : rest.endsWith("/data") ? "data" : null;
    if (facet) {
      const id = rest.slice(0, -(facet.length + 1));
      return `source/${id}/${facet}${variant ? `~${variant}` : ""}.html`;
    }
  }
  if (path.startsWith("/_pd/") || path.startsWith(PD_ROUTE_PREFIX.assets)) return path.slice(1);
  // Anything else is a shell route: one index.html per route, so deep links load without rewrites.
  const route = path.replace(/^\/+|\/+$/g, "");
  return route ? `${route}/index.html` : "index.html";
}

// ─────────────────────────────────────────────────────────────────────────────
// HMR socket messages  (dev-server → dev-ui, push over the hotreloader `ws` socket)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Protocol version of this file's wire shapes — HTTP responses AND socket messages.
 *
 * Bump it whenever a shape changes incompatibly (a field removed, renamed or retyped; an HMR arm
 * removed). Adding an optional field does not need a bump, and neither does adding an HMR arm: a shell
 * bundled before the arm existed receives it, matches none of its handlers and does nothing. The
 * server announces it three ways —
 * the `hello` socket message, the `X-PD-Protocol` response header, and `VersionInfo.protocol` —
 * and the shell compares it against the value it was bundled with, so a stale shell talking to a
 * newer server says so instead of misbehaving silently. Same idea as GRAPH_ARTIFACT_VERSION.
 */
export const PD_PROTOCOL_VERSION = 1;

/** Response header carrying PD_PROTOCOL_VERSION on every dev-server response. */
export const PD_PROTOCOL_HEADER = "X-PD-Protocol";

/**
 * The live-reload generation a `pd dev` response was rendered from: `<boot>.<n>`, where `<boot>` names the
 * server process and `<n>` counts the reload messages it has sent. Sent by a live server on every response
 * (this header), in `hello`, and on every reload message (content-swap, css-link-swap, tree-changed,
 * page-changed), bumped when such a message is sent, after the change's state is in place. A request takes
 * it before anything else, so a document rendered while a change landed carries the generation from before
 * it. A client that later sees a newer one knows its document may predate a change it never heard about
 * (sent while its socket was not open, or while its fetch was in flight) and fetches it again. Absent when
 * the server has no live reload (`pd build`). Additive: no protocol bump.
 */
export const PD_GENERATION_HEADER = "X-PD-Generation";

/** True when generation `a` is older than `b`: from an earlier server process, or a lower count. Either
 *  absent compares as not behind (a server without live reload never makes a client refetch). */
export function generationBehind(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const [bootA, countA] = a.split(".");
  const [bootB, countB] = b.split(".");
  return bootA !== bootB || Number(countA) < Number(countB);
}

/**
 * HMR socket messages, discriminated on `type`:
 *  - hello         : sent once per connection — carries PD_PROTOCOL_VERSION.
 *  - content-swap  : template / data / `.ts` change → re-fetch and swap the preview document.
 *  - css-link-swap : SCSS change → re-point the per-component `<link>` in the live iframe, no reload.
 *  - error         : a render or build failure, surfaced on the Console.
 *  - tree-changed  : a component was added or removed → re-fetch the tree.
 *  - collision     : a handle collision quarantined a component → surfaced on the Console.
 *  - page-changed  : a storefront page (or the nav) changed → storefront pages reload. The
 *                    workbench shell receives it too and ignores it.
 *
 * NOTE: A11yResult / meta.a11y were removed in M4.11. Rendered a11y findings are produced
 * client-side (axe in the live iframe) and do not flow through the HMR channel.
 */
/**
 * A CSS-only change rebuilt the affected component's origin file.
 * The client finds the matching `<link data-pd-comp>` in the iframe and
 * updates its href to the cache-busted URL — no srcdoc rewrite, no state loss.
 */
export interface CssLinkSwapMessage {
  type: "css-link-swap";
  /** Component whose per-origin CSS file changed. */
  componentId: ComponentId;
  /** New URL, e.g. "/_pd/components/atoms/button.css?v=1717000000000". */
  href: string;
  /**
   * Ordered closure hrefs for the currently-previewed component (`lastComponentId`).
   * Absent when no preview is active. Each href is `/_pd/components/<id>.css?v=<timestamp>`,
   * in DFS post-order (deepest dependency first). The client reconciles the preview head's
   * pd-managed links against this list: add missing, remove dead, bump survivors.
   * Only components with non-empty CSS output are included.
   */
  orderedHrefs?: string[];
  /** The generation this message bumped the server to (PD_GENERATION_HEADER); set by the server. */
  generation?: string;
}

/** Fired when a .hbs is added or removed — client re-fetches /api/tree to rebuild the nav. */
export interface TreeChangedMessage {
  type: "tree-changed";
  /** The generation this message bumped the server to (PD_GENERATION_HEADER); set by the server. */
  generation?: string;
}

/** M6: a handle collision was detected at discovery time. Both paths are named so the author
 *  can resolve the conflict (rename or move a file). The tree remains operational; the
 *  quarantined component is excluded until the collision is resolved. */
export interface CollisionMessage {
  type: "collision";
  handle: string;
  incumbentPath: string;
  quarantinedPath: string;
}

/** A storefront page changed. `route` names the page ("/guides/setup/"); null means a page was added
 *  or removed, so the nav — and with it every page — changed. */
export interface PageChangedMessage {
  type: "page-changed";
  route: string | null;
  /** The generation this message bumped the server to (PD_GENERATION_HEADER); set by the server. */
  generation?: string;
}

export type HmrMessage = HelloMessage | ContentSwapMessage | ErrorMessage | CssLinkSwapMessage | TreeChangedMessage | CollisionMessage | PageChangedMessage;

/** First frame on every connection. Lets the shell detect a protocol mismatch with the server. */
export interface HelloMessage {
  type: "hello";
  protocol: number;
  /** The current live-reload generation (PD_GENERATION_HEADER). */
  generation?: string;
}

export interface ContentSwapMessage {
  type: "content-swap";
  componentId: ComponentId;
  // No HTML payload: the iframe re-points/reloads its standalone document URL.
  /** The generation this message bumped the server to (PD_GENERATION_HEADER); set by the server. */
  generation?: string;
}

export interface ErrorMessage {
  type: "error";
  /** Which pipeline failed — keeps build errors from masquerading as render errors. */
  scope: "build" | "render";
  /** Component-scoped where known (e.g. a missing partial in this component). */
  componentId?: ComponentId;
  /** A legible, already-formatted message (per M1: not a raw Handlebars stack trace). */
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes for implementers
// ─────────────────────────────────────────────────────────────────────────────
//
// • Theme is a CLIENT concern: the shell stores the active theme in sessionStorage and
//   sets `data-theme` on the preview document body. It is NOT in this protocol — the
//   server doesn't need to know which theme the client is previewing. (Theme CSS files
//   themselves are served as static assets via the existing M1 theme-swap mechanism.)
//   NOTE this is the COMPONENT theme (#2 of the three theming systems, see docs/development/architecture.md);
//   the syntax-highlighter theme (#3) follows OS prefers-color-scheme and is also not here.
//
// • Routing is a CLIENT concern: `/atoms/button` (component), `/atoms` and `/atoms/input`
//   (folder overviews, M4.3) are History-API routes in the SPA. The data API is addressed by
//   id / folder path, not by the SPA URL. Deep-linking = the shell reads the path on mount and
//   fetches /api/component/:id or /api/overview/:path, and opens ancestor tree nodes.
//
// • Layout precedence (M4.2) is RESOLVED server-side: category default ← category index.md
//   frontmatter ← component override. The shell consumes the final LayoutMode on
//   ComponentDetail / FolderOverview(Item) / TreeNode and never re-derives it.
//
// • Tree (M4.3): recursive, rendered as native <details>/<summary> + <ul>/<li>. hasOverview is
//   true for group/category folders with ≥1 public component, with or without an index.md. Private components are nested
//   under their owner and hidden by default behind a show-internals toggle.
//
// • If implementing the shell reveals a gap here — e.g. the data API can't express a
//   `.json`-less component cleanly (it can: ComponentSource.json is optional), or a
//   multi-instance preview document needs addressing for later snapshots — stop and
//   extend this contract deliberately rather than working around it in one package.