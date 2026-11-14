// Per-component CSS: recompilation, the link closure, and class-borrowing derivation.
//
// `computeCssClosure` answers "which component stylesheets must this preview link, and in what
// order" — the closure walks composition edges so a component's includes bring their own CSS.
// Order is load-bearing: base first, then dependencies, then the component itself.
//
// `deriveClassBorrowingFields` produces the `styleUses` edge — the style graph. A component
// "borrows" when its template uses a class another component owns. That is derived from the
// class-ownership index (compiled CSS + source maps), never from guessing at SCSS text.
//
// Explicit arguments throughout; no server state. Depends on style-index and the composition
// registry type — the arrow points one way, neither imports this module back.

import type { PatternDirs } from "./pattern-dirs.js";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import * as sass from "sass";
import { SourceMapConsumer } from "source-map";
import { sassPackageOptions } from "@pattern-dump/build";
import { parse as parseHtml } from "node-html-parser";
import type { DiscoveryMap, RelationshipsAvailable } from "@pattern-dump/contracts";
import type { CompositionRegistry } from "./composition.js";
import {
  resolveScssToComponent, cssNodeText, joinCssChunks, addLastOccurrence,
  type ClassOwnerIndex, type BaseProvenanceIndex,
} from "./style-index.js";

/** Recompile a single SCSS entry file with source map and return the updated own-origin CSS
 *  for the given component id. Used by the HMR watcher to update perComponentCssCache.
 *  `inBase` marks files listed in documentBase: their rules belong to the base layer, never to the
 *  component, exactly as in buildAllStyleData. Returns null if compilation fails. `out.baseRules`
 *  receives the entry's base-layer rules (from documentBase files, and from files no component owns, such
 *  as a mixin's partial), joined as buildAllStyleData's `baseRulesByEntry` holds them. */
export async function recomputeComponentCss(
  entryFile: string,
  compId: string,
  stylesDir: string,
  componentIds: Set<string>,
  inBase: (absPath: string) => boolean = () => false,
  out?: { baseRules?: string },
): Promise<string | null> {
  try {
    const compiled = sass.compile(entryFile, { sourceMap: true, ...sassPackageOptions(entryFile) });
    const rawMap = compiled.sourceMap;
    if (!rawMap) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consumer = new SourceMapConsumer(rawMap as any);
    const root = postcss.parse(compiled.css);
    const bucket = new Set<string>();
    const base = new Set<string>();
    root.each(node => {
      const pos = node.source?.start;
      if (!pos) return;
      const original = consumer.originalPositionFor({ line: pos.line, column: pos.column - 1 });
      if (!original.source) return;
      const originPath = original.source.startsWith("file://")
        ? fileURLToPath(original.source)
        : resolve(dirname(entryFile), original.source);
      if (inBase(originPath)) { addLastOccurrence(base, cssNodeText(node)); return; }
      const originComp = resolveScssToComponent(originPath, stylesDir, componentIds);
      if (originComp === compId) addLastOccurrence(bucket, cssNodeText(node));
      else if (originComp === null) addLastOccurrence(base, cssNodeText(node));
    });
    if (out) out.baseRules = joinCssChunks(base);
    return joinCssChunks(bucket);
  } catch {
    return null;
  }
}

/** Compute the CSS closure for a component: DFS post-order traversal of composition (`uses`)
 *  and class-borrowing (`styleUses`) edges. Returns component ids in dependency order
 *  (deepest deps first, the requested component last). Uses a visited set to prevent cycles. */
export async function computeCssClosure(
  componentId: string,
  compReg: CompositionRegistry,
  patternsDir: PatternDirs,
  classOwnerIndex: ClassOwnerIndex,
  discoveryMap: DiscoveryMap
): Promise<string[]> {
  const visited = new Set<string>();
  const result: string[] = [];

  async function dfs(id: string): Promise<void> {
    if (visited.has(id)) return;
    visited.add(id);

    const compUses = compReg.uses.get(id) ?? [];

    const hbsPath = discoveryMap.get(id)?.hbsPath ?? "";
    let hbs = "";
    try { hbs = hbsPath ? await readFile(hbsPath, "utf-8") : ""; } catch { /* unreadable or missing .hbs — treat as empty markup, not a hard failure */ }
    const { styleUses } = deriveClassBorrowingFields(hbs, id, classOwnerIndex);

    // Recurse into all deps first (pre-DFS); push self after all deps (post-order).
    for (const dep of [...new Set([...compUses, ...styleUses])]) {
      await dfs(dep);
    }
    result.push(id);
  }

  await dfs(componentId);
  return result;
}

/**
 * Add the owners of classes that appear in the RENDERED markup but that the static closure missed.
 *
 * computeCssClosure reads templates, so it cannot see components included at render time by a
 * helper — hTWOo's `{{dynamicPartial this.type this}}` pulls in `atoms/input/label` from data, and
 * without this its `hoo-label` rules were never linked. Rendered markup is the ground truth: every
 * class in it whose owner is a component gets that component linked.
 *
 * Added owners are inserted before the requested component (which stays last) in sorted order, so
 * the result is deterministic and dependencies still precede the component that uses them.
 */
export function withRenderedClassOwners(
  closureIds: string[],
  renderedHtml: string,
  classOwnerIndex: ClassOwnerIndex,
): string[] {
  if (closureIds.length === 0) return closureIds;
  const present = new Set(closureIds);
  const extra = new Set<string>();
  for (const cls of extractUsedClasses(renderedHtml)) {
    const owner = classOwnerIndex.get(cls);
    if (owner && owner !== "__base__" && !present.has(owner)) extra.add(owner);
  }
  if (extra.size === 0) return closureIds;
  const self = closureIds[closureIds.length - 1];
  return [...closureIds.slice(0, -1), ...[...extra].sort(), self];
}

/** Extract static CSS class names from a raw .hbs source.
 *  Uses node-html-parser; Handlebars expressions parse as harmless text nodes.
 *  Drops tokens that contain {{ or }} (dynamic). Keeps static base of e.g.
 *  "hoo-button" from class="hoo-button hoo-button--{{variant}}". */
export function extractUsedClasses(hbsSource: string): string[] {
  const root = parseHtml(hbsSource);
  const classes = new Set<string>();
  for (const el of root.querySelectorAll("[class]")) {
    const raw = el.getAttribute("class") ?? "";
    for (const token of raw.split(/\s+/)) {
      if (token && !token.includes("{{") && !token.includes("}}")) {
        classes.add(token);
      }
    }
  }
  return [...classes];
}

/** Parse a raw .hbs source and derive the class-borrowing relationships fields:
 *  styleUses (other components whose classes appear here), inlineStyles flag,
 *  utilityClasses flag, and unattributedClasses (owned by nothing recognised). */
export function deriveClassBorrowingFields(
  hbsSource: string,
  componentId: string,
  classOwnerIndex: ClassOwnerIndex,
  baseProvenance?: BaseProvenanceIndex
): Pick<RelationshipsAvailable, "styleUses" | "styleModules" | "inlineStyles" | "utilityClasses" | "unattributedClasses"> {
  const usedClasses = extractUsedClasses(hbsSource);

  const styleUses = [...new Set(
    usedClasses
      .map(cls => classOwnerIndex.get(cls))
      .filter((id): id is string => id !== undefined && id !== componentId && id !== "__base__")
  )].sort();

  // Shared/base modules that AUTHOR a class worn by this markup — the module-level analog of
  // styleUses. These are exactly the "__base__" classes styleUses drops at the filter above;
  // instead of vanishing, they now report which shared module styled the component.
  const styleModules = baseProvenance
    ? [...new Set(
        usedClasses
          .filter(cls => classOwnerIndex.get(cls) === "__base__")
          .map(cls => baseProvenance.get(cls))
          .filter((m): m is string => m !== undefined)
      )].sort()
    : [];

  // Classes not in the index at all are unattributed. __base__ classes are in the index —
  // they're explained by the base/shared layer (now reported via styleModules) and NOT unattributed.
  const unattributedClasses = [...new Set(
    usedClasses.filter(cls => !classOwnerIndex.has(cls))
  )].sort();

  // No utility framework registered in test-bench → always false.
  const utilityClasses = false;

  const inlineStyles = /style\s*=|<style[\s>]/i.test(hbsSource);

  return { styleUses, styleModules, inlineStyles, utilityClasses, unattributedClasses };
}


/**
 * Narrow a CSS closure to the ids that actually have own-origin CSS.
 *
 * A component in the closure with no rules of its own would otherwise get a `<link>` to an empty
 * stylesheet — a real request for nothing. Takes the per-component CSS map explicitly rather than
 * reading server state, so it stays pure and both the preview routes and the HMR watcher can call
 * it with the same map.
 */
export function linkableClosure(closureIds: string[], perComponentCss: Map<string, string>): string[] {
  return closureIds.filter(id => !!perComponentCss.get(id));
}
