// The style index: which component owns which CSS class, and which shared modules style whom.
//
// This is the substrate for two of the four derived graphs (style and style-modules). The central
// property — and the reason this is not a regex over SCSS source — is that ownership is attributed
// from COMPILED CSS plus source maps, so nested selectors (`&__modifier`, `&--variant`) resolve to
// the component that actually defines them rather than to whatever text they were written near.
//
// `__base__` marks a class owned by a shared/base module rather than a component. Those are
// deliberately excluded from `styleUses` edges: a base class is not a navigable component target.
//
// Everything here takes explicit arguments — no server state. `patchClassOwnerIndex` mutates the
// index it is GIVEN (the caller owns the map), which is what lets the HMR path patch ownership
// incrementally per save instead of rebuilding the whole index.

import { dirname, join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { SourceMapConsumer } from "source-map";
import * as sass from "sass";
import { collectScssFiles, sassPackageOptions } from "@pattern-dump/build";
import { collapseComponentId, stripOrderPrefixes } from "@pattern-dump/discovery";
import { verboseTiming } from "./timing.js";

// ---- Serialising top-level CSS nodes into buckets ----

/** One top-level node as standalone CSS text. `node.toString()` leaves off the `;` of a blockless
 *  at-rule (`@import`, `@charset`, `@layer a, b`, `@namespace`) because PostCSS writes it from the
 *  parent; without it the next chunk is parsed into the at-rule's prelude and both are dropped. */
export function cssNodeText(node: postcss.ChildNode): string {
  const text = node.toString();
  return node.type === "atrule" && !node.nodes ? `${text};` : text;
}

/** Add a chunk to a bucket, keeping only its LAST position. When a stylesheet repeats a rule, the
 *  later copy is the one that wins the cascade; dropping the earlier copy is always safe, dropping
 *  the later one is not (`.a {} .b {} .a {}` must still end with `.a`). */
export function addLastOccurrence(bucket: Set<string>, chunk: string): void {
  bucket.delete(chunk);
  bucket.add(chunk);
}

/** Join serialised top-level chunks into one stylesheet. `@charset` and `@import` are honoured only
 *  at the top of a stylesheet, so they are hoisted ahead of every other chunk (relative order kept). */
export function joinCssChunks(chunks: Iterable<string>): string {
  const charset: string[] = [];
  const imports: string[] = [];
  const rest: string[] = [];
  for (const chunk of chunks) {
    if (/^@charset\b/i.test(chunk)) charset.push(chunk);
    else if (/^@import\b/i.test(chunk)) imports.push(chunk);
    else rest.push(chunk);
  }
  return [...charset.slice(0, 1), ...imports, ...rest].join("\n");
}

// ---- SCSS module graph (styleUsesModules only — component↔component @use is a convention
// violation that degrades to a plain non-navigable module path entry) ----

export interface ScssModuleGraph {
  styleUsesModules: Map<string, string[]>;
}

// ---- Class ownership index ----
// Maps CSS class name → ComponentId (owner component) | "__base__" (shared/base module).
// Built from compiled CSS + source maps so nested selectors (&__modifier, &--variant) are
// resolved correctly. "__base__" entries are excluded from styleUses (not a navigable target)
// and from unattributedClasses (they're explained by the @use closure).
export type ClassOwnerIndex = Map<string, string>;

// Maps CSS class name → StyleModuleId (the shared/base partial that AUTHORED it), for classes
// whose origin resolves to no component. SEPARATE from classOwnerIndex (which keeps the "__base__"
// sentinel intact so styleUses / unattributedClasses are undisturbed); this retains WHICH base
// module authored the class, so the styleModules relationship can report it. Only ever read for
// classes whose classOwnerIndex owner is "__base__".
export type BaseProvenanceIndex = Map<string, string>;

// ---- Which rule claims a class ----
// A rule DEFINES a class when one of its selectors is that class's own compound, with no ancestor or
// sibling context (`.card`, `.card:hover`, `.card.is-active`). Every other appearance is a MENTION:
// contextual overrides (`.tile .card`, `.card:checked + label`) and pseudo-class arguments
// (`:not(.card)`). When several rules claim one class, a defining claim beats a mention, then a
// component beats `__base__`, then the first writer wins. Without this, a project base rule that
// restyles a package class in context (`.tile .hoo-radio`) owned the class, and the package
// component that defines it was never linked.

interface SelectorClasses { defines: string[]; mentions: string[] }
const selectorClassCache = new Map<string, SelectorClasses>();

/** The classes a selector list defines (context-free compounds) and the ones it only mentions. */
export function selectorClasses(selector: string): SelectorClasses {
  const cached = selectorClassCache.get(selector);
  if (cached) return cached;
  const defines = new Set<string>();
  const mentions = new Set<string>();
  try {
    selectorParser(list => {
      list.each(complex => {
        const contextFree = !complex.some(node => node.type === "combinator");
        complex.walkClasses(cls => {
          (contextFree && cls.parent === complex ? defines : mentions).add(cls.value);
        });
      });
    }).processSync(selector);
  } catch {
    // Unparseable selector: fall back to treating every class-looking token as defined.
    for (const m of selector.matchAll(/\.([\w-]+)/g)) defines.add(m[1]);
  }
  for (const name of defines) mentions.delete(name);
  const result = { defines: [...defines], mentions: [...mentions] };
  selectorClassCache.set(selector, result);
  return result;
}

/** Precedence of a class claim: defining over mentioning, then a component over `__base__`. */
function claimRank(owner: string, defines: boolean): number {
  return (defines ? 2 : 0) + (owner === "__base__" ? 0 : 1);
}

/** The claim rank behind each class of an index built by buildAllStyleData, so the per-save patch
 *  applies the same precedence. Kept beside the index, not in it: the index stays a plain
 *  class → owner map for every reader. */
const indexRanks = new WeakMap<ClassOwnerIndex, Map<string, number>>();

/** Component ids keyed by their prefix-stripped form; null marks two ids that strip alike. Cached per
 *  Set: callers build a fresh id set per discovery pass (baseComponentIds) and never mutate it. */
const strippedIdCache = new WeakMap<Set<string>, Map<string, string | null>>();
function strippedIds(componentIds: Set<string>): Map<string, string | null> {
  let map = strippedIdCache.get(componentIds);
  if (!map) {
    map = new Map();
    for (const id of componentIds) {
      const key = stripOrderPrefixes(id);
      map.set(key, map.has(key) ? null : id);
    }
    strippedIdCache.set(componentIds, map);
  }
  return map;
}

export function resolveScssToComponent(absPath: string, stylesDir: string, componentIds: Set<string>): string | null {
  const rel = relative(stylesDir, absPath);
  let normalized = rel
    .replace(/\.scss$/, "")
    .split("/")
    .map(seg => seg.replace(/^_/, ""))
    .join("/");
  // _index.scss files resolve to their parent component dir (e.g. atoms/button/_index → atoms/button).
  if (normalized.endsWith("/index")) normalized = normalized.slice(0, -6);
  // Ask discovery for the id — apply the SAME collapse rule discovery used (<dir>/<dir> → <dir>),
  // rather than re-deriving here and diverging (e.g. atoms/avatar/avatar → atoms/avatar).
  const id = collapseComponentId(normalized);
  if (componentIds.has(id)) return id;
  // Otherwise match with ordering prefixes ignored on both sides, so `00-atoms/_badge.scss`,
  // `atoms/_badge.scss` and `01-atoms/_badge.scss` all find `00-atoms/badge` or `atoms/badge`.
  // Two components that differ only by prefix are ambiguous: attributed to neither.
  return strippedIds(componentIds).get(collapseComponentId(stripOrderPrefixes(normalized))) ?? null;
}

// Maps an absolute SCSS path that belongs to NO component to a human-readable StyleModuleId
// (e.g. /abs/styles/00-base/_tokens.scss → "00-base/tokens"). Keeps NN- dir prefixes.
//
// keepBarrel: for the @use-closure graph (default false) a bare _index.scss barrel is an
// intermediate re-export shim — its forwarded concrete modules already surface via loadedUrls,
// so the barrel is skipped (returns null) to avoid redundant paths. For CLASS-origin base
// provenance (keepBarrel=true) the _index.scss is the AUTHORING file of the rule, not a shim,
// so it must be named as the module (e.g. a class authored in 01-atoms/icons/_index.scss).
export function resolveSharedModulePath(absPath: string, stylesDir: string, keepBarrel = false): string | null {
  const rel = relative(stylesDir, absPath);
  if (rel.startsWith("..")) return null;
  const parts = rel.replace(/\.scss$/, "").split("/");
  const normalized = parts.map((seg, i) =>
    i === parts.length - 1 ? seg.replace(/^_/, "") : seg
  );
  if (!keepBarrel && normalized[normalized.length - 1] === "index") return null;
  return normalized.join("/");
}

export interface AllStyleData {
  scssModuleGraph: ScssModuleGraph;
  classOwnerIndex: ClassOwnerIndex;
  baseProvenance: BaseProvenanceIndex;
  componentCssMap: Map<string, string>;
  baseCss: string;
  /** Base-layer rules from files that no component owns and that a root's `documentBase` does not
   *  list: absolute path → rule count. Only for roots that declare a `documentBase`. */
  baseOutsideList: Map<string, number>;
}

// ---- documentBase: paths whose rules always form the base layer ----

/** A documentBase entry as a path relative to the styles folder, without `./`, a trailing `/` or
 *  `.scss`, and without the leading `_` of a partial's name. `""` stands for the whole tree. */
function normalizeBaseEntry(entry: string): string {
  const parts = entry.replace(/\\/g, "/").replace(/\.scss$/, "").split("/")
    .filter(seg => seg !== "" && seg !== ".");
  if (parts.length > 0) parts[parts.length - 1] = parts[parts.length - 1].replace(/^_/, "");
  return parts.join("/");
}

/**
 * Whether a stylesheet is listed in `documentBase`: the file itself, a folder containing it, or `.`
 * for the whole styles tree. Listed files form the base layer, linked beneath every preview, even
 * when the file would otherwise belong to a component.
 */
export function documentBaseMatcher(stylesDir: string, base: readonly string[] | undefined): (absPath: string) => boolean {
  const entries = (base ?? []).map(normalizeBaseEntry);
  if (entries.length === 0) return () => false;
  return absPath => {
    const rel = relative(stylesDir, absPath);
    if (rel.startsWith("..")) return false;
    const parts = rel.replace(/\\/g, "/").replace(/\.scss$/, "").split("/");
    parts[parts.length - 1] = parts[parts.length - 1].replace(/^_/, "");
    const file = parts.join("/");
    return entries.some(e => e === "" || file === e || file.startsWith(`${e}/`));
  };
}

/** The documentBase entries that name nothing on disk under the styles folder. */
export function missingDocumentBase(stylesDir: string, base: readonly string[] | undefined): string[] {
  return (base ?? []).filter(entry => {
    const e = normalizeBaseEntry(entry);
    if (e === "") return false;
    const dir = dirname(join(stylesDir, e));
    const name = e.split("/").pop()!;
    return ![join(stylesDir, e), join(dir, `${name}.scss`), join(dir, `_${name}.scss`)].some(existsSync);
  });
}

/** Single compile pass producing the SCSS module graph, class→owner index, per-component
 *  origin-bucketed CSS, and base CSS. One `sass.compile` call per entry file (in configured
 *  order, or sorted when discovered); `loadedUrls` feeds the module graph; the source map feeds
 *  class attribution and CSS bucketing. Claim precedence decides the class index. */
/**
 * Core class-attribution logic: given a compiled CSS root and its source-map consumer,
 * extract { className → owning component id } mappings for every rule in the output.
 * Tracing is via the source map (needed for Sass-expanded nesting like `& .foo`).
 * When the same class is claimed by several rules, the claim precedence above decides
 * (`selectorClasses`, `claimRank`); `ranks` carries the winning claim's rank so callers
 * merging several files apply the same precedence.
 *
 * This is the SINGLE implementation shared by both buildAllStyleData (full rebuild on
 * navigation) and attributeClassesFromFile → patchClassOwnerIndex (incremental per-save
 * patch). Column-offset fixes, nested-selector edge cases, and resolveScssToComponent
 * changes land here once and apply to both code paths automatically.
 */
export function extractClassesFromCompiled(
  consumer: SourceMapConsumer,
  root: postcss.Root,
  entryFile: string,
  stylesDir: string,
  componentIds: Set<string>
): { classMap: Map<string, string>; baseModules: BaseProvenanceIndex; ranks: Map<string, number> } {
  const classMap = new Map<string, string>();
  const baseModules: BaseProvenanceIndex = new Map();
  const ranks = new Map<string, number>();
  root.walkRules(rule => {
    const { defines, mentions } = selectorClasses(rule.selector);
    if (defines.length === 0 && mentions.length === 0) return;
    const pos = rule.source?.start;
    if (!pos) return;
    const original = consumer.originalPositionFor({ line: pos.line, column: pos.column - 1 });
    if (!original.source) return;
    const originPath = original.source.startsWith("file://")
      ? fileURLToPath(original.source)
      : resolve(dirname(entryFile), original.source);
    const resolved = resolveScssToComponent(originPath, stylesDir, componentIds);
    const owner = resolved ?? "__base__";
    // Base-class provenance: keep the authoring partial (barrel-retaining) when the origin
    // resolves to no component. Discarded here before; retained now for styleModules.
    const modulePath = resolved === null ? resolveSharedModulePath(originPath, stylesDir, true) : null;
    const claim = (name: string, rank: number): void => {
      const prev = ranks.get(name);
      if (prev === undefined || rank > prev) {
        classMap.set(name, owner);
        ranks.set(name, rank);
        // Base provenance belongs to the WINNING claim only, so a component that takes a class
        // over from a base rule leaves no stale module behind.
        if (modulePath && owner === "__base__") baseModules.set(name, modulePath);
        else baseModules.delete(name);
      } else if (modulePath && owner === "__base__" && classMap.get(name) === "__base__" && !baseModules.has(name)) {
        baseModules.set(name, modulePath);
      }
    };
    for (const name of defines) claim(name, claimRank(owner, true));
    for (const name of mentions) claim(name, claimRank(owner, false));
  });
  return { classMap, baseModules, ranks };
}

/**
 * Compile one SCSS entry file and return class → owning component id attributions.
 * Returns null if compilation fails.
 *
 * Called by patchClassOwnerIndex (per-save incremental update). Uses
 * extractClassesFromCompiled as the shared attribution core so both paths stay in sync.
 *
 * Exported so the attribution equivalence unit test can call it directly without
 * going through the full server startup.
 */
export async function attributeClassesFromFile(
  entryFile: string,
  stylesDir: string,
  componentIds: Set<string>
): Promise<{ classMap: Map<string, string>; ranks: Map<string, number> } | null> {
  try {
    const compiled = sass.compile(entryFile, { sourceMap: true, ...sassPackageOptions(entryFile) });
    if (!compiled.sourceMap) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consumer = new SourceMapConsumer(compiled.sourceMap as any);
    const root = postcss.parse(compiled.css);
    // Incremental patch path uses class ownership only; base provenance is rebuilt on the next
    // full buildAllStyleData (navigation-lag MVP), same as the @use module graph.
    const { classMap, ranks } = extractClassesFromCompiled(consumer, root, entryFile, stylesDir, componentIds);
    return { classMap, ranks };
  } catch {
    return null;
  }
}

/**
 * Incrementally update a ClassOwnerIndex for a single recompiled SCSS entry file.
 *
 * Algorithm:
 *  1. Remove all entries currently owned by changedCompId (clears stale claims so a
 *     deleted class disappears from the index, not just unchanged).
 *  2. Re-derive this entry's class attributions via attributeClassesFromFile (shared core
 *     — same algorithm as the navigation-time full build).
 *  3. Re-insert entries attributed to changedCompId where its claim outranks the surviving
 *     one (claim precedence, when the index came from buildAllStyleData), otherwise only
 *     where no claim survives.
 *
 * Mutates `index` in place. Returns true on a successful patch, false on compilation
 * failure (in which case step 1's removals are still applied — leaves the index slightly
 * conservative, which the next navigation full rebuild repairs).
 *
 * KNOWN DRIFT (acceptable, narrow): if class `.foo` is defined in both component C and
 * component D, and C is the full-build "first writer" (owns `.foo`), then later C
 * removes `.foo`: this patch drops C's claim and `.foo` disappears from the index
 * entirely — D's claim is NOT promoted, because we only reprocess C's file. The user
 * sees correct attribution after the next component navigation (full rebuild). Dual
 * class ownership across components is unusual; this trade buys 100–500× per-save speed.
 */
export async function patchClassOwnerIndex(
  entryFile: string,
  changedCompId: string,
  stylesDir: string,
  componentIds: Set<string>,
  index: ClassOwnerIndex
): Promise<boolean> {
  const ranks = indexRanks.get(index);
  // Step 1: clear stale claims by changedCompId so removed classes drop out.
  for (const [cls, owner] of index) {
    if (owner === changedCompId) { index.delete(cls); ranks?.delete(cls); }
  }
  // Step 2: re-derive from the recompiled file using the shared attribution core.
  const fresh = await attributeClassesFromFile(entryFile, stylesDir, componentIds);
  if (!fresh) return false;
  // Step 3: re-insert this component's classes where they win against the survivors.
  for (const [name, owner] of fresh.classMap) {
    if (owner !== changedCompId) continue;
    const rank = fresh.ranks.get(name) ?? 0;
    const prev = ranks?.get(name);
    if (!index.has(name) || (prev !== undefined && rank > prev)) {
      index.set(name, owner);
      ranks?.set(name, rank);
    }
  }
  return true;
}

/** One SCSS tree for buildAllStyleData: its folder, optionally the only entries to compile, and its
 *  documentBase (paths whose rules always go into the base layer). */
export interface StyleDataRoot {
  dir: string;
  entries?: string[];
  base?: readonly string[];
}

/**
 * Build all style data over one SCSS tree, or several (the project's first, then pattern packages').
 * Each rule is attributed against the tree it was authored in, so a package's `01-atoms/button.scss`
 * owns `atoms/button` exactly as the project's would. The class index follows the claim precedence
 * across trees, ties going to the first writer (the project first); the shared base layer is emitted packages first, so the project's own
 * base rules come later in the cascade and win.
 */
export async function buildAllStyleData(
  roots: string | StyleDataRoot[],
  componentIds: Set<string>,
  entryOverride?: string[]
): Promise<AllStyleData> {
  if (verboseTiming) console.time("[dev-server:timing] full classOwnerIndex build");

  const styleUsesModules = new Map<string, string[]>();
  const classIndex: ClassOwnerIndex = new Map();
  const classRanks = new Map<string, number>();
  indexRanks.set(classIndex, classRanks);
  const baseProvenance: BaseProvenanceIndex = new Map();
  const componentCssBuckets = new Map<string, Set<string>>();
  const baseCssByRoot: string[][] = [];
  // Distinct rule texts per unlisted, unowned file (a shared partial compiles into several entries).
  const outsideRules = new Map<string, Set<string>>();

  for (const id of componentIds) styleUsesModules.set(id, []);

  const rootList: StyleDataRoot[] = typeof roots === "string"
    ? [{ dir: roots, ...(entryOverride ? { entries: entryOverride } : {}) }]
    : roots;

  for (const styleRoot of rootList) {
  const stylesDir = styleRoot.dir;
  const inBase = documentBaseMatcher(stylesDir, styleRoot.base);
  const reportOutside = (styleRoot.base?.length ?? 0) > 0;
  const baseCssBucket = new Set<string>();
  baseCssByRoot.push([]);

  let entryFiles: string[] = [];
  if (styleRoot.entries && styleRoot.entries.length > 0) {
    // Configured styles.entry: compile ONLY these (resolved absolute by the caller), in the order
    // given. A configured list is the cascade order, so it is never re-sorted.
    entryFiles = [...styleRoot.entries];
  } else {
    // Discovered entries have no inherent order: sort them for determinism.
    try { entryFiles = (await collectScssFiles(stylesDir)).sort(); } catch { entryFiles = []; }
  }

  for (const entryFile of entryFiles) {
    const compOwner = resolveScssToComponent(entryFile, stylesDir, componentIds);

    let compiled: sass.CompileResult;
    try { compiled = sass.compile(entryFile, { sourceMap: true, ...sassPackageOptions(entryFile) }); }
    catch { continue; }

    // ---- Module graph (from loadedUrls, same as old buildScssModuleGraph) ----
    if (compOwner) {
      const deps = compiled.loadedUrls
        .filter(u => u.protocol === "file:")
        .map(u => fileURLToPath(u))
        .filter(p => resolve(p) !== resolve(entryFile));

      for (const dep of deps) {
        const depComp = resolveScssToComponent(dep, stylesDir, componentIds);
        if (depComp !== null && depComp !== compOwner) {
          const rawRel = relative(stylesDir, dep).replace(/\.scss$/, "");
          const modPath = rawRel.endsWith("/_index") ? rawRel.slice(0, -7) : rawRel;
          if (modPath) {
            const mArr = styleUsesModules.get(compOwner) ?? [];
            if (!mArr.includes(modPath)) { mArr.push(modPath); styleUsesModules.set(compOwner, mArr); }
          }
        } else if (depComp === null) {
          const modPath = resolveSharedModulePath(dep, stylesDir);
          if (modPath) {
            const mArr = styleUsesModules.get(compOwner) ?? [];
            if (!mArr.includes(modPath)) { mArr.push(modPath); styleUsesModules.set(compOwner, mArr); }
          }
        }
      }
    }

    // ---- Class owner index + CSS bucketing (from source map) ----
    const rawMap = compiled.sourceMap;
    if (!rawMap) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consumer = new SourceMapConsumer(rawMap as any);
    const root = postcss.parse(compiled.css);

    /** Absolute origin file of a top-level node, from the source map. */
    function originPathFor(node: postcss.Node): string | null {
      const pos = node.source?.start;
      if (!pos) return null;
      const original = consumer.originalPositionFor({
        line: pos.line,
        column: pos.column - 1,
      });
      if (!original.source) return null;
      return original.source.startsWith("file://")
        ? fileURLToPath(original.source)
        : resolve(dirname(entryFile), original.source);
    }

    // CSS bucketing: walk top-level nodes (rules + at-rules: @font-face, @keyframes, etc.)
    root.each(node => {
      const originPath = originPathFor(node);
      if (originPath === null) return;
      const nodeText = cssNodeText(node);
      // A file listed in documentBase is base-layer CSS, whichever component it would belong to.
      const owner = inBase(originPath)
        ? "__base__"
        : resolveScssToComponent(originPath, stylesDir, componentIds) ?? "__base__";
      if (owner === "__base__") {
        addLastOccurrence(baseCssBucket, nodeText);
        if (reportOutside && !inBase(originPath)) {
          const seen = outsideRules.get(originPath) ?? new Set<string>();
          seen.add(nodeText);
          outsideRules.set(originPath, seen);
        }
      } else {
        const bucket = componentCssBuckets.get(owner) ?? new Set<string>();
        addLastOccurrence(bucket, nodeText);
        componentCssBuckets.set(owner, bucket);
      }
    });

    // Class owner index: delegate to the shared attribution core so the per-save patch
    // (patchClassOwnerIndex via attributeClassesFromFile) and this full build cannot drift.
    const { classMap: perFileClasses, baseModules: perFileBaseModules, ranks: perFileRanks } =
      extractClassesFromCompiled(consumer, root, entryFile, stylesDir, componentIds);
    for (const [name, owner] of perFileClasses) {
      const rank = perFileRanks.get(name) ?? 0;
      const prev = classRanks.get(name);
      const mod = perFileBaseModules.get(name);
      if (prev === undefined || rank > prev) {
        // Claim precedence across files and roots; ties keep the first writer (the project first).
        classIndex.set(name, owner);
        classRanks.set(name, rank);
        if (mod) baseProvenance.set(name, mod);
        else baseProvenance.delete(name);
      } else if (mod && classIndex.get(name) === "__base__" && !baseProvenance.has(name)) {
        baseProvenance.set(name, mod);
      }
    }
  }

  baseCssByRoot[baseCssByRoot.length - 1] = [...baseCssBucket];
  }

  for (const [k, v] of styleUsesModules) styleUsesModules.set(k, [...new Set(v)].sort());

  const componentCssMap = new Map<string, string>();
  for (const [id, bucket] of componentCssBuckets) {
    componentCssMap.set(id, joinCssChunks(bucket));
  }

  if (verboseTiming) console.timeEnd("[dev-server:timing] full classOwnerIndex build");
  return {
    scssModuleGraph: { styleUsesModules },
    classOwnerIndex: classIndex,
    baseProvenance,
    componentCssMap,
    // Packages' base rules first (later roots), the project's last — its own base wins the cascade.
    baseCss: joinCssChunks([...baseCssByRoot].reverse().flat()),
    baseOutsideList: new Map([...outsideRules].map(([path, rules]) => [path, rules.size])),
  };
}

