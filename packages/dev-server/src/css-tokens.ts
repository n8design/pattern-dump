// Custom properties read from compiled CSS: the one walk behind a theme's swatches (themes.ts), the colour tokens of
// the document base layer, which a symbol image's standalone file declares (symbols.ts), and the properties each
// rule reads and declares, for the graph (the end of this file).
//
// A LEAF: postcss over a string, no files, no server state.
//
// `scopedDeclarations` lists every custom property declared in a rule whose selector is in scope, in document
// order, each with the at-rule it sits in: none, `@media (prefers-color-scheme: dark)` or `@supports`. A theme reads
// the last value of each name. `baseTokens` resolves each `--color-*` of `:root` / `html` to a light and a dark value,
// the way a current browser does:
//
//   - `light-dark(a, b)` anywhere gives light `a` and dark `b`;
//   - a declaration inside `@supports` wins over one outside it (it is the one a browser that passes the test uses,
//     the outside one its fallback);
//   - outside `@supports`, a value is light and dark alike, unless `@media (prefers-color-scheme: dark)` declares the
//     same name again, which gives dark;
//   - `var(--x)` is replaced by `--x`'s light or dark value, followed through further `var()`s.
//
// Sass is never read: the values are those of the CSS PD compiled. A value that can't be resolved this way (a cycle,
// a `var()` to an unknown name, `light-dark()` without two values) is reported, not guessed.

import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

export type DeclarationContext = "plain" | "media-dark" | "supports" | "other";

export interface ScopedDeclaration { prop: string; value: string; context: DeclarationContext }

/** Every declaration `wanted` accepts (by default, every custom property) in a rule `inScope` accepts (by its
 *  selectors), in document order. */
export function scopedDeclarations(
  css: string, inScope: (selectors: string[]) => boolean, wanted: (prop: string) => boolean = p => p.startsWith("--"),
): ScopedDeclaration[] {
  const out: ScopedDeclaration[] = [];
  postcss.parse(css).walkRules(rule => {
    if (!inScope(rule.selectors)) return;
    const context = contextOf(rule);
    rule.walkDecls(decl => {
      if (wanted(decl.prop)) out.push({ prop: decl.prop, value: decl.value, context });
    });
  });
  return out;
}

/** The at-rule a rule (or a nested at-rule) sits in, as a declaration's context. */
export function contextOf(rule: postcss.Rule | postcss.AtRule): DeclarationContext {
  let context: DeclarationContext = "plain";
  for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
    if (p.type !== "atrule") continue;
    const at = p as postcss.AtRule;
    if (at.name === "supports") return "supports";
    if (at.name === "media" && /prefers-color-scheme\s*:\s*dark/i.test(at.params)) context = "media-dark";
    else context = "other";
  }
  return context;
}

export interface TokenValue { light: string; dark: string }

export interface BaseTokens {
  /** Each `--color-*` of `:root` / `html` that resolves, by name. */
  tokens: Map<string, TokenValue>;
  /** Each name that is declared but can't be resolved, with why. */
  unresolved: Map<string, string>;
}

const ROOT = (selectors: string[]): boolean => selectors.some(s => s.trim() === ":root" || s.trim() === "html");

/** The colour tokens of the document base layer: every `--color-*` on `:root` / `html`, as a light and a dark value. */
export function baseTokens(css: string): BaseTokens {
  const raw = new Map<string, { plain?: string; dark?: string; supports?: string }>();
  for (const d of scopedDeclarations(css, ROOT)) {
    if (d.context === "other") continue;
    const entry = raw.get(d.prop) ?? {};
    if (d.context === "supports") entry.supports = d.value;
    else if (d.context === "media-dark") entry.dark = d.value;
    else entry.plain = d.value;
    raw.set(d.prop, entry);
  }
  // Each name's light and dark value before var() is followed.
  const split = new Map<string, TokenValue>();
  const unresolved = new Map<string, string>();
  for (const [name, e] of raw) {
    const chosen = e.supports ?? e.plain;
    if (chosen === undefined) {
      // Only a dark value: there is nothing for light.
      unresolved.set(name, "it is declared only inside @media (prefers-color-scheme: dark)");
      continue;
    }
    const ld = lightDark(chosen);
    if (ld === "invalid") { unresolved.set(name, `light-dark() needs two values: ${chosen}`); continue; }
    if (ld) { split.set(name, ld); continue; }
    const darkRaw = e.supports === undefined && e.dark !== undefined ? e.dark : chosen;
    const darkLd = lightDark(darkRaw);
    if (darkLd === "invalid") { unresolved.set(name, `light-dark() needs two values: ${darkRaw}`); continue; }
    split.set(name, { light: chosen, dark: darkLd ? darkLd.dark : darkRaw });
  }
  const tokens = new Map<string, TokenValue>();
  for (const name of split.keys()) {
    if (!name.startsWith("--color-")) continue;
    const light = follow(split, name, "light", []);
    const dark = follow(split, name, "dark", []);
    const problem = typeof light === "object" ? light.problem : typeof dark === "object" ? dark.problem : undefined;
    if (problem !== undefined) unresolved.set(name, problem);
    else tokens.set(name, { light: light as string, dark: dark as string });
  }
  for (const name of unresolved.keys()) if (!name.startsWith("--color-")) unresolved.delete(name);
  return { tokens, unresolved };
}

/** `light-dark(a, b)` as its two values; null for any other value; "invalid" when it hasn't two. */
function lightDark(value: string): TokenValue | null | "invalid" {
  const m = /^light-dark\(([\s\S]*)\)$/i.exec(value.trim());
  if (!m) return null;
  const parts = topLevelSplit(m[1]!);
  return parts.length === 2 && parts.every(p => p !== "") ? { light: parts[0]!, dark: parts[1]! } : "invalid";
}

function topLevelSplit(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) { parts.push(s.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(s.slice(start).trim());
  return parts;
}

/** A name's value in one mode with every `var()` replaced; a problem when one can't be. */
function follow(split: Map<string, TokenValue>, name: string, mode: "light" | "dark", seen: string[]): string | { problem: string } {
  if (seen.includes(name)) return { problem: `its value refers to itself (${[...seen, name].join(" → ")})` };
  const own = split.get(name);
  if (!own) return { problem: `${seen.length ? `${seen[seen.length - 1]} refers to ${name}, which` : name} is not declared on :root` };
  let problem: string | undefined;
  const value = own[mode].replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (all, ref: string, fallback?: string) => {
    if (problem !== undefined) return all;
    if (!split.has(ref) && fallback !== undefined) return fallback.trim();
    const r = follow(split, ref, mode, [...seen, name]);
    if (typeof r === "object") { problem = r.problem; return all; }
    return r;
  });
  if (problem === undefined && /\bvar\(/.test(value)) problem = `var() it can't follow: ${own[mode]}`;
  return problem !== undefined ? { problem } : value;
}

// ---- Which custom properties a stylesheet reads and declares (the graph's uses-property and declares edges) ----
//
// Read per compiled rule, so a var() a Sass mixin or variable wrote sits on the selector that includes it. A use is
// keyed to the class the rule styles: per complex selector, the classes of the rightmost compound that has one
// (`.card > div` styles inside `.card`); the classes of the compounds before it are its context (`.tile .card`:
// `.card` within `.tile`). A class in a pseudo-class's argument (`:not(.x)`) is neither. A selector with no class at
// all (`:root`, `body`) keys the use to the stylesheet itself (`class: null`).

/** One place a rule reads a property: the class it styles (null: a rule with no class), and the classes it does so
 *  inside, empty for an own use. */
export interface PropertyUse { property: string; class: string | null; within: string[]; selector: string }

/** What a stylesheet's rules read and declare. `uses`: one per property, class and context, the first selector. */
export interface PropertyFacts {
  uses: PropertyUse[];
  declares: Map<string, { selector: string; context: DeclarationContext }>;
}

export const emptyPropertyFacts = (): PropertyFacts => ({ uses: [], declares: new Map() });

const PROPERTY_NAME = /^--[\w-]+$/;

/** Every custom property a value reads, once each, in order: each `var(--x)`, one inside another's fallback too. A
 *  name Sass would build (`--#{$x}`) never reaches compiled CSS, so none is skipped here. */
export function varNames(value: string): string[] {
  const out = new Set<string>();
  for (const m of value.matchAll(/\bvar\(\s*(--[\w-]+)/gi)) out.add(m[1]!);
  return [...out];
}

/** Where a selector list's rule applies, per complex selector: the classes it styles and the classes it does so
 *  inside. `classes` empty: a selector with no class. */
const anchorCache = new Map<string, Array<{ classes: string[]; within: string[] }>>();
export function selectorAnchors(selector: string): Array<{ classes: string[]; within: string[] }> {
  const cached = anchorCache.get(selector);
  if (cached) return cached;
  const out: Array<{ classes: string[]; within: string[] }> = [];
  try {
    selectorParser(list => {
      list.each(complex => {
        const compounds: string[][] = [[]];
        for (const node of complex.nodes) {
          if (node.type === "combinator") compounds.push([]);
          else if (node.type === "class") compounds[compounds.length - 1]!.push(node.value);
        }
        let at = compounds.length - 1;
        while (at >= 0 && compounds[at]!.length === 0) at--;
        if (at < 0) { out.push({ classes: [], within: [] }); return; }
        out.push({ classes: [...new Set(compounds[at])], within: [...new Set(compounds.slice(0, at).flat())] });
      });
    }).processSync(selector);
  } catch {
    // A selector postcss-selector-parser can't read: every class-looking token is styled, none is context.
    const classes = [...new Set([...selector.matchAll(/\.([\w-]+)/g)].map(m => m[1]!))];
    out.length = 0;
    out.push({ classes, within: [] });
  }
  if (anchorCache.size >= 20_000) anchorCache.clear();
  anchorCache.set(selector, out);
  return out;
}

/** Add what one rule reads and declares to `facts`: its declarations only, not a nested rule's (each rule is walked
 *  on its own). */
export function addRuleProperties(rule: postcss.Rule, facts: PropertyFacts): void {
  const seen = useKeys(facts);
  const read: string[] = [];
  let context: DeclarationContext | undefined;
  for (const node of rule.nodes ?? []) {
    if (node.type !== "decl") continue;
    if (PROPERTY_NAME.test(node.prop) && !facts.declares.has(node.prop)) {
      facts.declares.set(node.prop, { selector: rule.selector, context: context ??= contextOf(rule) });
    }
    for (const name of varNames(node.value)) if (!read.includes(name)) read.push(name);
  }
  if (read.length === 0) return;
  for (const anchor of selectorAnchors(rule.selector)) {
    for (const cls of anchor.classes.length ? anchor.classes : [null]) {
      for (const property of read) {
        const key = `${property}\u0000${cls ?? ""}\u0000${anchor.within.join(" ")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        facts.uses.push({ property, class: cls, within: anchor.within, selector: rule.selector });
      }
    }
  }
}

/** An `@property --x` rule declares `--x`. */
export function addAtRuleProperty(at: postcss.AtRule, facts: PropertyFacts): void {
  const name = at.params.trim();
  if (at.name.toLowerCase() === "property" && PROPERTY_NAME.test(name) && !facts.declares.has(name)) {
    facts.declares.set(name, { selector: `@property ${name}`, context: contextOf(at) });
  }
}

/** The keys of the uses `facts` holds, so a later rule adds only what is new. Kept per facts object. */
const keysOf = new WeakMap<PropertyFacts, Set<string>>();
function useKeys(facts: PropertyFacts): Set<string> {
  let keys = keysOf.get(facts);
  if (!keys) {
    keys = new Set(facts.uses.map(u => `${u.property}\u0000${u.class ?? ""}\u0000${u.within.join(" ")}`));
    keysOf.set(facts, keys);
  }
  return keys;
}

/** What a whole stylesheet reads and declares (a theme's compiled CSS, an assets.css file, a template's `<style>`).
 *  Text that doesn't parse gives nothing. `from` names the input: without it PostCSS draws a random id from
 *  Math.random, which would move a project helper's seeded sequence (plain-stylesheets.ts). */
export function propertyFacts(css: string, from: string): PropertyFacts {
  const facts = emptyPropertyFacts();
  let root: postcss.Root;
  try { root = postcss.parse(css, { from }); } catch { return facts; }
  root.walk(node => {
    if (node.type === "rule") addRuleProperties(node, facts);
    else if (node.type === "atrule") addAtRuleProperty(node, facts);
  });
  return facts;
}
