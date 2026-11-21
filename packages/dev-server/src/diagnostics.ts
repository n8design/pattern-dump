// The diagnostics graph: what is machine-detectably wrong with each component.
//
// The fourth derived graph, and the one that arrives at a different question with the same shape as
// the other three — a bipartite component<->rule graph keyed on the same discovery identity, so it
// can be queried alongside them rather than bolted on.
//
// Two properties worth preserving deliberately:
//
//  - Findings are TAGGED where they are recorded, as [SUBJECT-DEBT] (the audited system's defect) or
//    [PD-GAP] (ours). Untagged, every finding silently defaults to "make PD accept it", and PD grows
//    a compatibility layer for the very debt it exists to eliminate.
//  - Re-auditing is incremental and CSS-INVARIANT: a template edit re-audits exactly that component,
//    an SCSS edit re-audits none, because the covered engines cannot be affected by CSS. There is a
//    tripwire test on that asymmetry; adding a CSS-sensitive rule must break it.
//
// The renderer is INJECTED (`CheckRenderer`) rather than constructed here — that is what lets the
// same sweep run under the live server and headless from `pd audit`. The headless bootstrap itself
// stays in index.ts with the other orchestration, following the export.ts precedent: pure shaping
// moves out, I/O orchestration stays.

import { checkCodeDigest } from "./check-code.js";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CompositionRegistry } from "./composition.js";
import { borrowedStyleMessage, borrowedStyles } from "./css-closure.js";
import type { ClassOwnerIndex } from "./style-index.js";
import { recordPartialLookups } from "./partial-lookups.js";
import { runA11yProducer } from "@pattern-dump/a11y";
import type {
  CollisionEntry, Diagnostic, DiagnosticEngine, DiagnosticTag,
  DiagnosticComponentNode, DiagnosticOccurrence, DiagnosticsGraph, DiscoveryMap, RenderOutcome,
  RuleNode,
} from "@pattern-dump/contracts";
import { ensureScratchDir, pdScratchDir } from "./scratch.js";

// ---- Per-component static check unit ----

/** The renderer as the check unit uses it — id + optional variant → html + optional diagnostics. */
export type CheckRenderer = (input: { component: string; variant?: string }) =>
  Promise<{ html: string; meta?: { diagnostics?: Diagnostic[] } }>;

/**
 * The single per-component static-check unit. Renders a component's fragment and returns the
 * rendered HTML plus its merged, machine-detectable diagnostics: render()'s html-validate + schema
 * diagnostics and the structural axe producer (alwaysOn tier). A quarantined component short-circuits
 * to a HANDLE_COLLISION diagnostic (no render); a render throw becomes a single RENDER_ERROR.
 *
 * Keyed on the discovery id (`componentId`) — the same id composition and style graphs use, so the
 * diagnostics graph converges with them by merge, not a second identity scheme. The /api/component
 * handler uses this for the panel; the corpus sweep calls it per component.
 *
 * SCOPE BOUNDARY: the rendered-contrast (`needsRendering`) axe tier — contrast, aria-hidden-focus,
 * duplicate-id-aria — requires real browser layout/paint and runs client-side in the live preview
 * iframe only. It is deliberately NOT run here, so the static sweep covers fewer rule types than the
 * per-component panel. This is a boundary, not a miss.
 */
export async function checkComponent(
  componentId: string,
  variant: string | undefined,
  render: CheckRenderer,
  quarantineEntry: CollisionEntry | undefined,
): Promise<{ previewHtml: string; diagnostics: Diagnostic[] }> {
  if (quarantineEntry) {
    return {
      previewHtml: "",
      diagnostics: [{
        kind: "HANDLE_COLLISION",
        severity: "error",
        source: "discovery",
        message:
          `quarantined; handle \`${quarantineEntry.handle}\` is held by ` +
          `\`${quarantineEntry.incumbentId}\`; rename to resolve.`,
      }],
    };
  }
  try {
    const result = await render({ component: componentId, variant });
    const previewHtml = result.html;
    const renderDiags = result.meta?.diagnostics ?? [];
    // A11y structural producer (M4.10): runs node-side on the rendered fragment (alwaysOn tier).
    const a11yDiags = await runA11yProducer(previewHtml);
    return { previewHtml, diagnostics: [...renderDiags, ...a11yDiags] };
  } catch (e) {
    // A render error that knows where it happened (a missing helper: the template that called it) says so.
    const location = e instanceof Error && "location" in e ? (e as { location?: Diagnostic["location"] }).location : undefined;
    return {
      previewHtml: "",
      diagnostics: [{
        kind: "RENDER_ERROR",
        severity: "error",
        source: "render",
        message: e instanceof Error ? e.message : String(e),
        ...(location && Object.keys(location).length ? { location } : {}),
      }],
    };
  }
}

/**
 * STYLE_BORROWED, one info per owner a component's template borrows from (css-closure.ts, borrowedStyles): it uses a
 * class that owner's stylesheet styles without including the owner, so the owner's stylesheet is linked into its
 * preview too. A variant with markup of its own is read from its own template. On the component's detail only, not
 * in the corpus audit: the audit's hash leaves CSS out by design (componentContentHash), and a borrow is CSS.
 */
export async function styleBorrowedDiagnostics(
  componentId: string, variant: string | undefined, discoveryMap: DiscoveryMap, composition: CompositionRegistry,
  classOwnerIndex: ClassOwnerIndex,
): Promise<Diagnostic[]> {
  const entry = (variant ? discoveryMap.get(`${componentId}~${variant}`) : undefined) ?? discoveryMap.get(componentId);
  const hbs = entry?.hbsPath ? await readFile(entry.hbsPath, "utf-8").catch(() => "") : "";
  const included = new Set(includeClosure(variant ? `${componentId}~${variant}` : componentId, composition));
  return borrowedStyles(hbs, componentId, classOwnerIndex, included).map(b => ({
    kind: "STYLE_BORROWED" as const, severity: "info" as const, source: "render" as const,
    message: borrowedStyleMessage(componentId, b),
  }));
}

// ---- Diagnostics graph ----

/** Map a diagnostic's source to its detection engine (the engine dimension of a rule node). */
function engineForDiagnostic(diag: Diagnostic): DiagnosticEngine {
  switch (diag.source) {
    case "axe":       return "axe";
    case "html":      return "html-validate";
    case "schema":    return "schema";
    case "discovery": return "discovery";
    default:          return "render"; // "render" + the rare "cascade"/"highlight" edge kinds
  }
}

/** The rule id within the engine — the granular rule when present, else the coarse kind. */
function ruleIdForDiagnostic(diag: Diagnostic): string {
  return diag.ruleId ?? diag.kind;
}

/**
 * PD-GAP allowlist. Everything defaults to SUBJECT-DEBT — the subject owns its own templates, so a
 * RENDER_ERROR / HANDLE_COLLISION / validation finding is the subject's debt by default (e.g. hTWOo's
 * shimmer RENDER_ERROR is [H2O-DEBT], not a PD gap). A finding is PD-GAP ONLY when it matches a
 * signature PD KNOWS is its own detector/pipeline fault. Intentionally EMPTY at Phase 1 — no PD-GAP is
 * proven for the corpus; grows only as concrete PD-internal failures are identified. Never infer
 * PD-GAP from `kind` alone.
 */
const PD_GAP_SIGNATURES: Array<(diag: Diagnostic) => boolean> = [
  // (none yet — add a predicate only when a specific finding is proven to be PD's own fault)
];

function tagForDiagnostic(diag: Diagnostic): DiagnosticTag {
  return PD_GAP_SIGNATURES.some(match => match(diag)) ? "PD-GAP" : "SUBJECT-DEBT";
}

/** Render outcome — metadata on the component node, NEVER a defect. A template that threw is `error`
 *  (also emitted as a RENDER_ERROR occurrence); empty output is `blank` (data-masked or a base
 *  synthesized from variants — legitimately empty, no defect edge); otherwise `ok`. */
function renderOutcomeFor(previewHtml: string, diagnostics: Diagnostic[]): RenderOutcome {
  if (diagnostics.some(d => d.kind === "RENDER_ERROR")) return "error";
  return previewHtml.trim() === "" ? "blank" : "ok";
}

/** The per-component slice of the graph: its node + its occurrence edges. The cacheable unit. */
export interface ComponentAudit {
  node: DiagnosticComponentNode;
  occurrences: DiagnosticOccurrence[];
}

/** Audit one component or variant (`base~v`) -> its node + occurrences. Reuses `checkComponent`, the exact
 *  per-component unit the panel uses, so the aggregate cannot drift from the panel. A variant is rendered as its
 *  own detail renders it (the base with the variant), and keeps its own id. */
export async function auditComponent(
  id: string, render: CheckRenderer, quarantineEntry: CollisionEntry | undefined,
): Promise<ComponentAudit> {
  const tilde = id.indexOf("~");
  const [base, variant] = tilde < 0 ? [id, undefined] : [id.slice(0, tilde), id.slice(tilde + 1)];
  const { previewHtml, diagnostics } = await checkComponent(base, variant, render, quarantineEntry);
  const occurrences: DiagnosticOccurrence[] = diagnostics.map(diag => {
    const domPath = diag.kind === "A11Y" ? diag.target : undefined;
    return {
      engine: engineForDiagnostic(diag),
      ruleId: ruleIdForDiagnostic(diag),
      component: id,
      severity: diag.severity,
      message: diag.message,
      ...(domPath ? { domPath } : {}),
      tag: tagForDiagnostic(diag),
    };
  });
  return { node: { id, render: renderOutcomeFor(previewHtml, diagnostics) }, occurrences };
}

/** Assemble the bipartite graph from per-component slices - derive rule nodes from the occurrences.
 *  Storage IS the graph; rule-count / per-component / per-engine are views over `occurrences`. */
export function assembleGraph(audits: ComponentAudit[]): DiagnosticsGraph {
  const components = audits.map(a => a.node).sort((a, b) => a.id.localeCompare(b.id));
  const occurrences = audits.flatMap(a => a.occurrences);
  const ruleNodes = new Map<string, RuleNode>(); // "engine ruleId" -> node (two distinct dims)
  for (const o of occurrences) {
    const key = `${o.engine} ${o.ruleId}`;
    if (!ruleNodes.has(key)) ruleNodes.set(key, { engine: o.engine, ruleId: o.ruleId, displayKey: `${o.engine}:${o.ruleId}` });
  }
  const rules = [...ruleNodes.values()].sort((a, b) =>
    a.engine === b.engine ? a.ruleId.localeCompare(b.ruleId) : a.engine.localeCompare(b.engine));
  return { rules, components, occurrences };
}

/**
 * Full sweep - audit every component and assemble the graph. Component nodes key on the discovery id
 * (2.1). A blank / synthesized-empty render yields a `blank` node but NO defect edge; a render throw
 * yields `error` + a RENDER_ERROR edge.
 */
export async function buildDiagnosticsGraph(
  componentIds: Iterable<string>,
  render: CheckRenderer,
  quarantineMap: Map<string, CollisionEntry>,
): Promise<DiagnosticsGraph> {
  const audits: ComponentAudit[] = [];
  for (const id of [...componentIds].sort()) audits.push(await auditComponent(id, render, quarantineMap.get(id)));
  return assembleGraph(audits);
}

// ---- Persistence + per-component hash (section 4) ----

// 2: a component's hash covers what it includes (AuditInputs), so a cache keyed on its own files alone is dropped.
export const GRAPH_ARTIFACT_VERSION = 2;

/** The on-disk artifact: the graph plus the per-component content hashes it was derived from. Lives at
 *  a PD-owned path OUTSIDE the project root (the root may be read-only). The disk copy is cacheable and
 *  therefore SUSPECT - a component's cached slice is trusted only when its stored hash still matches the
 *  freshly-computed one (the four-state rule on the artifact); a version bump discards it wholesale. */
interface PersistedDiagnostics {
  version: number;
  hashes: Record<string, string>;
  /** What each component's render included by name through a project helper (AuditedSlice.includes). */
  includes?: Record<string, string[]>;
  graph: DiagnosticsGraph;
}

export function graphArtifactPath(root: string): string {
  return join(pdScratchDir(root), "diagnostics-graph.json");
}

export async function readDiagnosticsArtifact(root: string): Promise<PersistedDiagnostics | null> {
  try {
    // Only from a scratch folder that is this user's alone: anyone else could have written an audit that matches the
    // project's hashes and reports nothing. A folder that fails the check is no cache: the audit runs in full.
    await ensureScratchDir(root);
    const parsed = JSON.parse(await readFile(graphArtifactPath(root), "utf-8")) as PersistedDiagnostics;
    return parsed.version === GRAPH_ARTIFACT_VERSION ? parsed : null; // version mismatch -> discard
  } catch { return null; }
}

// Written to a file beside it, then renamed over it. A rename within one folder replaces the file in one
// step, so a reader (headless `pd audit`, another pd dev on the same root) sees the old artifact or the
// new one, never part of one: a torn read parses as "no artifact" and costs a full re-audit.
async function writeDiagnosticsArtifact(root: string, art: PersistedDiagnostics): Promise<void> {
  await ensureScratchDir(root);
  const path = graphArtifactPath(root);
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(art));
    await rename(temp, path);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}

/**
 * What a component's audit depends on besides its own files, read once for an audit pass: the design system (to
 * follow what a component includes), the composition graph, and the digest of everything every render shares (the
 * global data, the project helpers' source). Made by auditInputs; the same for `pd audit`, the workbench's seed and
 * pd dev's live re-audits.
 */
export interface AuditInputs {
  readonly discoveryMap: DiscoveryMap;
  /** Handle to component id: a partial a helper looked up is named by its handle. */
  readonly handleMap: ReadonlyMap<string, string>;
  readonly composition: CompositionRegistry;
  /** The global data and the project helpers' source, digested: in every component's hash. */
  readonly digest: string;
  /** A file's text for this pass ("" when it can't be read). */
  text(path: string): Promise<string>;
  /** Every template, data and schema file of the design system, digested once for this pass. */
  everything(): Promise<string>;
  /** The components a handle collision quarantined: a quarantined one's verdict depends on who keeps the handle. */
  readonly quarantine?: ReadonlyMap<string, CollisionEntry>;
}

/** Every file under `path` (a file, or a folder read through), sorted. */
async function filesUnder(path: string): Promise<string[]> {
  const s = await stat(path).catch(() => undefined);
  if (!s) return [];
  if (!s.isDirectory()) return [path];
  const entries = await readdir(path, { recursive: true, withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => join(e.parentPath, e.name)).sort();
}

export async function auditInputs(o: {
  discoveryMap: DiscoveryMap; handleMap: ReadonlyMap<string, string>; composition: CompositionRegistry;
  globalData: Record<string, unknown> | undefined; helperPaths?: readonly string[];
  quarantine?: ReadonlyMap<string, CollisionEntry>;
}): Promise<AuditInputs> {
  const texts = new Map<string, Promise<string>>();
  const text = (path: string): Promise<string> => {
    let t = texts.get(path);
    if (!t) { t = readFile(path, "utf-8").catch(() => ""); texts.set(path, t); }
    return t;
  };
  const helpers = createHash("sha1");
  for (const file of (await Promise.all((o.helperPaths ?? []).map(filesUnder))).flat()) {
    helpers.update(file).update(" ").update(await readFile(file).catch(() => Buffer.alloc(0))).update(" ");
  }
  let all: Promise<string> | undefined;
  const everything = (): Promise<string> => all ??= (async () => {
    const h = createHash("sha1");
    const paths = [...new Set([...o.discoveryMap.values()].flatMap(e => [e.hbsPath, e.jsonPath, e.schemaPath]).filter((p): p is string => !!p))].sort();
    for (const p of paths) h.update(p).update(" ").update(await text(p)).update(" ");
    return h.digest("hex");
  })();
  return {
    discoveryMap: o.discoveryMap, handleMap: o.handleMap, composition: o.composition,
    digest: createHash("sha1").update(globalDataDigest(o.globalData)).update(" ").update(helpers.digest("hex")).digest("hex"),
    text, everything, ...(o.quarantine ? { quarantine: o.quarantine } : {}),
  };
}

/** `id` and everything its render can include: what its templates include, through every level (the composition
 *  graph), a variant's base, and `also` (what a helper included by name) with what those include. In a stable order. */
export function includeClosure(id: string, composition: CompositionRegistry, also: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const queue = [id, ...also];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    if (next.includes("~")) queue.push(next.split("~")[0]!);
    queue.push(...composition.uses.get(next) ?? []);
  }
  return [id, ...[...seen].filter(x => x !== id).sort()];
}

/** Whether `template` has a dynamic partial (`{{> (expr)}}`): Handlebars resolves its name at render time, where a
 *  project helper's lookups are noted (partial-lookups.ts) but this one is not, so it can include any template. */
const mayIncludeAnything = (template: string): boolean => /\{\{~?#?>\s*\(/.test(template);

/**
 * A component's content hash: everything its audit depends on, so a matching hash means its static findings can't
 * have changed. Its own template, data and schema, and those of every component its render can include (the include
 * closure: partials at any depth, a variant's base, and `includes`, what a project helper included by name when it
 * was audited); when one of those templates has a dynamic partial, every file of the design system; the global data and the project
 * helpers' source (`inputs.digest`); and the check code (check-code.ts), since a verdict cached by other code is not
 * this code's verdict.
 *
 * NOTE (recon corrects section 4): the spec's hash includes "relevant CSS", but the covered static
 * engines - structural axe (alwaysOn, jsdom, no CSS), html-validate, schema, render - do NOT read CSS.
 * Contrast (the only CSS-dependent rule) is the excluded needsRendering tier. So CSS is deliberately
 * OUT of the hash: including it would over-invalidate on style edits that cannot change any static
 * finding.
 */
export async function componentContentHash(
  id: string, inputs: AuditInputs, checkCode: string = checkCodeDigest(), includes: readonly string[] = [],
): Promise<string> {
  const h = createHash("sha1").update(id);
  // A quarantined component is reported, not rendered: its verdict is the collision, which names the handle and the
  // component that keeps it.
  const q = inputs.quarantine?.get(id);
  if (q) h.update(" quarantined ").update(q.handle).update(" ").update(q.incumbentId);
  let open = false;
  for (const member of includeClosure(id, inputs.composition, includes)) {
    const entry = inputs.discoveryMap.get(member);
    const hbs = entry?.hbsPath ? await inputs.text(entry.hbsPath) : "";
    const json = entry?.jsonPath ? await inputs.text(entry.jsonPath) : "";
    const schema = entry?.schemaPath ? await inputs.text(entry.schemaPath) : "";
    h.update(" ").update(member).update(" ").update(hbs).update(" ").update(json).update(" ").update(schema);
    if (!open && mayIncludeAnything(hbs)) open = true;
  }
  if (open) h.update(" everything ").update(await inputs.everything());
  return h.update(" ").update(inputs.digest).update(" ").update(checkCode).digest("hex");
}

/** The digest of the global data, part of every component's hash. */
export function globalDataDigest(globalData: Record<string, unknown> | undefined): string {
  return createHash("sha1").update(JSON.stringify(globalData ?? {})).digest("hex");
}

/** One component's audit, with the hash of exactly the content it audited. */
export interface AuditedSlice {
  readonly audit: ComponentAudit;
  readonly hash: string;
  /** The components a project helper included by name while it was audited (partial-lookups.ts): in its hash. */
  readonly includes: readonly string[];
}

/**
 * Audit one component and capture the hash of what was audited. The audit reads the files itself, so the
 * files are hashed before and after it; when they changed during it, it runs again. The hash kept is
 * therefore never one read later (at persist time) for content the audit did not see.
 */
export async function auditWithHash(
  id: string, render: CheckRenderer, quarantine: CollisionEntry | undefined, inputs: AuditInputs, known: readonly string[] = [],
): Promise<AuditedSlice> {
  // The component's files and what it includes read fresh before and after, not from the pass's reading. The hash
  // before an audit covers what the last audit saw included; when this one saw other partials looked up by name, it
  // runs again with those, so the hash kept always covers what the audit it belongs to included.
  const fresh: AuditInputs = { ...inputs, text: path => readFile(path, "utf-8").catch(() => "") };
  let includes = [...known].sort();
  for (let tries = 0; ; tries++) {
    const before = await componentContentHash(id, fresh, undefined, includes);
    const { value: audit, names } = await recordPartialLookups(() => auditComponent(id, render, quarantine));
    const seen = [...new Set([...names].map(n => inputs.handleMap.get(n)).filter((x): x is string => !!x && x !== id))].sort();
    const same = seen.length === includes.length && seen.every((x, i) => x === includes[i]);
    if (same && await componentContentHash(id, fresh, undefined, includes) === before) return { audit, hash: before, includes };
    includes = seen;
    // What it includes keeps changing (a helper that picks at random): a hash nothing matches, so it is never reused.
    if (tries >= 4) return { audit, hash: `unstable ${randomUUID()}`, includes };
  }
}

/**
 * Build or refresh the graph against the disk artifact. For each component: compute its hash; if the
 * prior artifact holds the SAME hash, reuse its cached slice (validated, not trusted blind); otherwise
 * re-audit. Writes the refreshed artifact. Returns which components were re-audited vs reused - the
 * section 3/4 cold-start delta, and the instrument for the incremental benchmark.
 */
export async function refreshDiagnosticsGraph(
  root: string,
  componentIds: Iterable<string>,
  render: CheckRenderer,
  quarantineMap: Map<string, CollisionEntry>,
  inputs: AuditInputs,
): Promise<{ graph: DiagnosticsGraph; audited: Map<string, AuditedSlice>; reaudited: string[]; reused: number }> {
  const prior = await readDiagnosticsArtifact(root);

  const priorNodes = new Map((prior?.graph.components ?? []).map(c => [c.id, c] as const));
  const priorOcc = new Map<string, DiagnosticOccurrence[]>();
  for (const o of prior?.graph.occurrences ?? []) {
    const arr = priorOcc.get(o.component) ?? [];
    arr.push(o); priorOcc.set(o.component, arr);
  }

  const audited = new Map<string, AuditedSlice>();
  const reaudited: string[] = [];
  for (const id of [...componentIds].sort()) {
    const includes = prior?.includes?.[id] ?? [];
    const h = await componentContentHash(id, inputs, undefined, includes);
    const priorNode = priorNodes.get(id);
    if (prior && prior.hashes[id] === h && priorNode) {
      audited.set(id, { audit: { node: priorNode, occurrences: priorOcc.get(id) ?? [] }, hash: h, includes }); // hash-validated reuse
    } else {
      audited.set(id, await auditWithHash(id, render, quarantineMap.get(id), inputs, includes));
      reaudited.push(id);
    }
  }

  await persistSlices(root, audited);
  return { graph: assembleGraph([...audited.values()].map(s => s.audit)), audited, reaudited, reused: audited.size - reaudited.length };
}

/** Persist the in-memory slices with the hash each was audited at, so a later cold start can reuse them.
 *  Called after live re-audits too, so the disk artifact tracks the live graph. Nothing is read from disk:
 *  a hash read now could be of content saved after the audit, and would validate a stale slice. */
export async function persistSlices(root: string, slices: Map<string, AuditedSlice>): Promise<void> {
  const hashes: Record<string, string> = {};
  const includes: Record<string, string[]> = {};
  for (const [id, slice] of slices) {
    hashes[id] = slice.hash;
    if (slice.includes.length) includes[id] = [...slice.includes];
  }
  await writeDiagnosticsArtifact(root, {
    version: GRAPH_ARTIFACT_VERSION, hashes, includes, graph: assembleGraph([...slices.values()].map(s => s.audit)),
  });
}
