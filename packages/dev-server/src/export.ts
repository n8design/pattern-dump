// @pattern-dump/dev-server — export collapse (B7, [SUBJECT-DEBT] → corrected form)
//
// Pure module — no I/O. Given a flattening cluster (the near-duplicate family the detector found) and
// the member sources, it decides whether the family LOSSLESSLY collapses to shape (a) — one base +
// `~*.json` modifier overlays — and, if so, shapes that corrected form.
//
// THE GATE IS A CORRECTNESS PRECONDITION, NOT A CONVENIENCE. A flattening cluster (skeleton similarity
// ≥ θ + shared class root) is NECESSARY but NOT SUFFICIENT for a shape-(a) collapse: the detector
// clusters families that also differ in markup/content (different includes, differing ids, different
// data-context) which a modifier-only collapse would DESTROY. Slice 1 collapses a family only when
// BOTH hold, verified corpus-wide:
//   (a) members are byte-identical except the ROOT ELEMENT's class tokens (lossless shape (a)), AND
//   (b) the base has empty `usedBy` tree-wide (no include site → no §6/§7 param-threading hazard).
// (b) is checked by the caller (planExport) against the composition registry. (a) is checked here.
//
// FAITHFUL, NOT CORRECTIVE (same discipline as the flattening diagnostic and the D1 thesis): a passing
// family's on-disk values ride into the ONE base VERBATIM — drift the detector flagged (a dropped
// `one-line` token, a copy-pasted `</meuu>` typo) is preserved unchanged. The win is N→1 (one visible
// defect, flagged once), never N→0 (PD guessing a fix). PD reads what the subject declares.

import { deriveHandle } from "@pattern-dump/discovery";
import type { FlatteningCluster } from "./flattening.js";

/** One source member of a family: its id, its patterns-relative path (no `.hbs`), raw markup, and its
 *  raw sibling data JSON (the component's defaults) if present.
 *  `relPath` is load-bearing: the collapsed id loses a base file's folder (`atoms/table/table.hbs` →
 *  id `atoms/table`), so folder/stem grouping MUST come from the real path, not the id.
 *  `dataJson` is load-bearing too: the collapse is behaviour-preserving only if the base's defaults
 *  data rides along (D1 §6 `defaults ← variant`) — dropping it renders an empty component. */
export interface FamilyMember {
  id: string;
  relPath: string;   // e.g. "atoms/table/table-compact" (patterns-relative, no extension)
  hbs: string;
  dataJson?: string; // raw contents of the member's sibling .json (its defaults), if any
}

/** The corrected form of one flattened family that PASSED the shape-(a) gate. */
export interface CollapsedFamily {
  baseId: string;                 // collapsed base id (slash id), e.g. "atoms/table" or ".../ql-list-button"
  root: string;                   // shared static class root, e.g. "hoo-table"
  baseHbs: string;                // the base template: shared skeleton, root class = `<root>{{ modifier }}<tail>`
  baseData?: Record<string, unknown>; // the base-default member's data → base defaults (deep-inherited)
  variants: CollapsedVariant[];   // one per source member, `~` identity preserved
}

export interface CollapsedVariant {
  token: string;                  // the `~` token, e.g. "compact" (base-default member → "")
  sourceId: string;               // original member id it collapses (identity preserved)
  modifier: string;               // lifted axis value: the member's root-class statics minus root, verbatim
  data?: Record<string, unknown>; // per-variant data DELTA vs base defaults (top-level keys that differ)
}

/** Why a clustered family was NOT collapsed in slice 1 (reported, never written). */
export type SkipReason =
  | "cross-folder"                // members span folders — not one family; ambiguous base
  | "not-lossless-shape-a";       // members differ beyond the root class — a modifier-only collapse would lose markup

export interface CollapseResult {
  family?: CollapsedFamily;       // present iff the gate passed
  skip?: SkipReason;              // present iff the gate failed
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Path helpers on slash ids (no node:path — this module stays pure/portable). */
const idFolder = (id: string): string => { const i = id.lastIndexOf("/"); return i < 0 ? "" : id.slice(0, i); };
const idStem = (id: string): string => { const i = id.lastIndexOf("/"); return i < 0 ? id : id.slice(i + 1); };

/**
 * Derive the family's base id + per-member `~` tokens from the shared FOLDER + common STEM prefix of
 * the real FILE PATHS (not the collapsed ids — a base file's id loses its folder). Returns null if the
 * members do not share a folder (a cross-folder cluster is not one family).
 *
 *  - `atoms/table/table` + `atoms/table/table-compact` → base `atoms/table`, tokens { "", "compact" }
 *    (a member whose stem IS the base stem is the base-default variant, token "").
 *  - `.../ql-list-button-outline` + `.../ql-list-button-fill` → base `.../ql-list-button`,
 *    tokens { outline, fill }.
 * The base id is collapsed the same way discovery collapses it: folder `<x>/<name>` + stem `<name>`
 * → `<x>/<name>` (folder basename equals stem).
 */
export function deriveFamilyNaming(members: Array<{ id: string; relPath: string }>): { baseId: string; tokens: Map<string, string> } | null {
  const folders = new Set(members.map((m) => idFolder(m.relPath)));
  if (folders.size !== 1) return null; // cross-folder — not a single family
  const folder = [...folders][0];
  const stems = members.map((m) => idStem(m.relPath));

  // Longest common stem prefix, cut back to a `-` boundary so a token is never split mid-word.
  let lcp = stems[0];
  for (const s of stems.slice(1)) {
    let i = 0;
    while (i < lcp.length && i < s.length && lcp[i] === s[i]) i++;
    lcp = lcp.slice(0, i);
  }
  const dash = lcp.lastIndexOf("-");
  const baseStem = dash > 0 ? lcp.slice(0, dash) : lcp;

  const tokens = new Map<string, string>();
  for (const m of members) {
    const stem = idStem(m.relPath);
    const rest = stem === baseStem ? "" : stem.slice(baseStem.length).replace(/^-/, "");
    tokens.set(m.id, rest);
  }

  const folderBase = idStem(folder); // basename of the folder
  const baseId = folder === "" ? baseStem : (folderBase === baseStem ? folder : `${folder}/${baseStem}`);
  return { baseId, tokens };
}

/** The root element's class attribute, split into static modifier tokens (minus the root) and the
 *  trailing Handlebars remainder (a `{{#if …}}…{{/if}}` that is constant across members and stays in
 *  the base). Returns null if the member has no class attribute containing the root token. */
function analyzeRootClass(hbs: string, root: string): { attr: string; staticMods: string[]; hbsTail: string } | null {
  const m = hbs.match(new RegExp(`class="([^"]*\\b${escapeRe(root)}\\b[^"]*)"`));
  if (!m) return null;
  const value = m[1];
  const hbsTail = (value.match(/\{\{[^}]*\}\}/g) ?? []).join("");
  const staticMods = value
    .replace(/\{\{[^}]*\}\}/g, " ")     // drop hbs expressions
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t !== root);         // everything on the root element except the root token = the modifier
  return { attr: m[0], staticMods, hbsTail };
}

/**
 * Shape-(a) gate + collapse. Returns a CollapsedFamily iff every member is byte-identical to the base
 * once its root-element class value is normalized to `<root><tail>` (i.e. the ONLY difference is the
 * static modifier tokens on the root element). Otherwise returns the skip reason.
 *
 * Reconstruction is faithful: base = member-0's markup with the root class value rewritten to
 * `<root>{{ modifier }}<tail>`; each overlay's modifier is that member's static tokens (leading space).
 */
export function collapseFamily(cluster: FlatteningCluster, members: FamilyMember[]): CollapseResult {
  const naming = deriveFamilyNaming(members);
  if (!naming) return { skip: "cross-folder" };

  const root = cluster.root;
  const byId = new Map(members.map((m) => [m.id, m.hbs]));

  // Analyze each member's root class; require the constant hbs tail to match, and everything OUTSIDE
  // the root class attribute to be byte-identical.
  const analyses = new Map<string, { staticMods: string[]; hbsTail: string; normalized: string }>();
  let tail0: string | null = null;
  for (const id of cluster.members) {
    const hbs = byId.get(id) ?? "";
    const a = analyzeRootClass(hbs, root);
    if (!a) return { skip: "not-lossless-shape-a" };
    if (tail0 === null) tail0 = a.hbsTail;
    else if (a.hbsTail !== tail0) return { skip: "not-lossless-shape-a" };
    // Normalize: collapse the whole root class value to `<root><tail>` so members differing only in
    // modifier statics become identical.
    const normalized = hbs.replace(a.attr, `class="${root}${a.hbsTail}"`);
    analyses.set(id, { staticMods: a.staticMods, hbsTail: a.hbsTail, normalized });
  }
  const normSet = new Set([...analyses.values()].map((v) => v.normalized));
  if (normSet.size !== 1) return { skip: "not-lossless-shape-a" };

  // Passed. Build the base from member-0, injecting `{{ modifier }}` after the root token.
  const base0 = byId.get(cluster.members[0]) ?? "";
  const a0 = analyzeRootClass(base0, root)!;
  const baseHbs = base0.replace(a0.attr, `class="${root}{{ modifier }}${a0.hbsTail}"`);

  // The base-default member (token "") supplies the base's defaults data; other members deep-inherit it
  // (D1 §6). Without this the collapse renders an empty component — the data is not optional.
  const dataById = new Map(members.map((m) => [m.id, parseData(m.dataJson)]));
  const baseDefaultId = cluster.members.find((id) => (naming.tokens.get(id) ?? "") === "");
  const baseData = baseDefaultId ? dataById.get(baseDefaultId)! : {};

  const variants: CollapsedVariant[] = cluster.members.map((id) => {
    const mods = analyses.get(id)!.staticMods;
    const token = naming.tokens.get(id) ?? "";
    const delta = token === "" ? {} : topLevelDelta(dataById.get(id)!, baseData);
    return {
      token,
      sourceId: id,
      modifier: mods.length ? " " + mods.join(" ") : "",
      ...(Object.keys(delta).length ? { data: delta } : {}),
    };
  });

  return { family: { baseId: naming.baseId, root, baseHbs, ...(Object.keys(baseData).length ? { baseData } : {}), variants } };
}

/** One include-site rewrite target: an old flat member's handle → the collapsed base's handle + the
 *  modifier value to thread as an include param. */
export interface SiteRewrite {
  baseHandle: string;   // the collapsed base's dash handle, e.g. "molecules-ql-list-button"
  modifier: string;     // the lifted axis value to thread, verbatim from the variant (leading space or "")
}

/**
 * Build the include-rewrite map for a set of THREADED families: `oldFlatHandle → { baseHandle, modifier }`.
 *
 * This is NOT a new synthesis — it re-keys `collapseFamily`'s existing output. Each `CollapsedVariant`
 * already carries `sourceId` (the original flat member's slash id) and `modifier` (the lifted value);
 * the map turns those into the HANDLES the include sites actually reference (sites reference dash
 * handles, never slash ids), using discovery's own `deriveHandle` so keys cannot drift from `handleMap`.
 *
 * Faithful: the `modifier` is exactly what the collapsed `~*.json` overlay carries — the rewrite adds
 * that value, it never repairs or recomputes it.
 */
export function buildRewriteMap(families: CollapsedFamily[]): Map<string, SiteRewrite> {
  const map = new Map<string, SiteRewrite>();
  for (const fam of families) {
    const baseHandle = deriveHandle(fam.baseId);
    for (const v of fam.variants) {
      map.set(deriveHandle(v.sourceId), { baseHandle, modifier: v.modifier });
    }
  }
  return map;
}

/**
 * Rewrite an includer's hbs so every include of a collapsed flat member points at the collapsed BASE
 * with the lifted `modifier` threaded as an include param (D1 §6/§7). Pure — returns the rewritten hbs
 * and the count of sites changed.
 *
 * PARAM-LIST-AWARE, ADD-NEVER-OVERWRITE: existing include params are preserved verbatim and the
 * `modifier` is appended — `{{> ql-list-button-outline quick-link=this }}` →
 * `{{> ql-list-button quick-link=this modifier=" …" }}`. A rewrite that dropped `quick-link=this` would
 * render broken; the merge keeps every existing param.
 *
 * FAITHFUL: the modifier is exactly `map`'s value (the collapsed `~*.json`), never recomputed.
 *
 * Handles inline `{{> name … }}` and block `{{#> name … }}…{{/name}}` (the block CLOSE tag is renamed to
 * the base handle too), quoted (`{{> "a~b" }}`) and unquoted names, and whitespace-control markers.
 * The base handle carries no `~`, so the rewritten partial name is always unquoted.
 */
export function rewriteIncludes(hbs: string, map: Map<string, SiteRewrite>): { hbs: string; rewrites: number } {
  let rewrites = 0;
  const blockRenames = new Map<string, string>(); // oldBareName → baseHandle, for block CLOSE rewriting

  // Inline + block-OPEN partials: {{~? #? > <name> <params?> ~?}}. The name group excludes the block
  // CLOSE (`{{/name}}`) because a `>` is required after `{{~?#?`. `[\s\S]*?` is non-greedy so it stops at
  // the open tag's own `}}`, never swallowing block content.
  let out = hbs.replace(
    /(\{\{~?)(#?)>(\s*)("[^"]+"|[^\s}"]+)([\s\S]*?)(~?\}\})/g,
    (full: string, open: string, hash: string, _ws: string, rawName: string, rest: string, close: string): string => {
      const bare = rawName.replace(/^"|"$/g, "");
      const hit = map.get(bare);
      if (!hit) return full;
      rewrites++;
      if (hash === "#") blockRenames.set(bare, hit.baseHandle);
      const existing = rest.trim();
      const merged = [existing, `modifier="${hit.modifier}"`].filter(Boolean).join(" ");
      return `${open}${hash}> ${hit.baseHandle} ${merged}${close}`;
    },
  );

  // Block CLOSE tags for any block partial we rewrote: {{~?/oldName~?}} → {{/baseHandle}}.
  if (blockRenames.size) {
    out = out.replace(
      /(\{\{~?)\/(\s*)("[^"]+"|[^\s}"]+)(\s*~?\}\})/g,
      (full: string, open: string, _ws: string, rawName: string, close: string): string => {
        const bare = rawName.replace(/^"|"$/g, "");
        const base = blockRenames.get(bare);
        return base ? `${open}/${base}${close}` : full;
      },
    );
  }

  return { hbs: out, rewrites };
}

/** Parse a member's raw data JSON; a missing/unparseable file is an empty object (no defaults). */
function parseData(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

/** Top-level keys where `variant` differs from `base` (by value identity). Arrays/objects are compared
 *  whole and included whole when they differ — matching D1 §6 (PD replaces arrays, does not index-merge).
 *  A variant that equals the base yields {} → the overlay carries only its modifier, data inherited. */
function topLevelDelta(variant: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(variant)) {
    if (JSON.stringify(v) !== JSON.stringify(base[k])) out[k] = v;
  }
  return out;
}
