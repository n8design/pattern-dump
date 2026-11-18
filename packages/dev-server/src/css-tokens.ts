// Custom properties read from compiled CSS: the one walk behind a theme's swatches (themes.ts) and the colour
// tokens of the document base layer, which a symbol image's standalone file declares (symbols.ts).
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

function contextOf(rule: postcss.Rule): DeclarationContext {
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
