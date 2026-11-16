// What a stylesheet says, for pd build's two style checks (class-check.ts, property-check.ts): the classes its
// selectors name, the custom properties it defines, and each var() it reads without a fallback, with its line.
//
// - Compiled CSS is read with postcss (readCss): what it defines is what a browser gets, whatever Sass built it from.
// - A project's style sources (SCSS or CSS) are scanned as text (sourceVarUses), comments taken out, for where a
//   var() is written. A name Sass builds (`--#{$name}`) is not a name yet, so it is skipped, never guessed.
// - Defined: `--x: ...` in any rule or at-rule, and `@property --x`.
// - A use: `var(--x)`. `var(--x, fallback)` has a fallback and is no use to check; a var() inside the fallback is
//   read on its own (`var(--a, var(--b))` uses --b).

import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

/** A var() without a fallback: the property it reads, and where (1-based). */
export interface VarUse { name: string; line: number; column: number }

export interface CssVocabulary {
  classes: Set<string>;
  properties: Set<string>;
  uses: VarUse[];
}

const SASS_NAME = /#\{/;
const NAME = /^--[\w-]+$/;

/** Every var() in `text` without a fallback, by its offset: a scan that matches parentheses, so a var() inside
 *  another's fallback, or inside calc(), is found too. Quoted strings are skipped. */
export function varUses(source: string): { name: string; offset: number }[] {
  const out: { name: string; offset: number }[] = [];
  // A string's contents blanked, offsets kept: nothing in quotes is a var() or a parenthesis.
  const text = source.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, q => `${q[0]}${" ".repeat(q.length - 2)}${q[0]}`);
  const re = /\bvar\(/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1, i = m.index + m[0].length, comma = -1;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i]!;
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 1 && comma < 0) comma = i;
    }
    const end = comma >= 0 ? comma : i - 1;
    const name = text.slice(m.index + m[0].length, end).trim();
    if (comma < 0 && NAME.test(name) && !SASS_NAME.test(name)) out.push({ name, offset: m.index });
  }
  return out;
}

/** The classes a selector names. */
export function selectorClassNames(selector: string): string[] {
  const out: string[] = [];
  try {
    selectorParser(root => { root.walkClasses(c => { out.push(c.value); }); }).processSync(selector);
  } catch { /* not a selector postcss-selector-parser reads: no classes from it */ }
  return out;
}

const position = (text: string, offset: number): { line: number; column: number } => {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length, column: before.at(-1)!.length + 1 };
};

/** The classes, defined custom properties and var() uses (by line in `text`) of compiled CSS. */
export function readCss(text: string): CssVocabulary {
  const classes = new Set<string>(), properties = new Set<string>(), uses: VarUse[] = [];
  let root: postcss.Root;
  try {
    root = postcss.parse(text);
  } catch {
    return { classes, properties, uses };
  }
  root.walk(node => {
    if (node.type === "rule") {
      for (const c of selectorClassNames(node.selector)) classes.add(c);
    } else if (node.type === "atrule") {
      if (node.name.toLowerCase() === "property" && NAME.test(node.params.trim())) properties.add(node.params.trim());
    } else if (node.type === "decl") {
      if (NAME.test(node.prop)) properties.add(node.prop);
      const at = node.source?.start?.offset;
      for (const u of varUses(node.value)) {
        // Where the value starts in the text, when postcss says; else the declaration's own line.
        const start = at !== undefined ? text.indexOf(node.value, at) : -1;
        const p = start >= 0 ? position(text, start + u.offset) : { line: node.source?.start?.line ?? 0, column: node.source?.start?.column ?? 0 };
        uses.push({ name: u.name, ...p });
      }
    }
  });
  return { classes, properties, uses };
}

/** `text` with its comments blanked (newlines kept, so lines and columns stay): `/* *\/`, and in SCSS `//` to the end
 *  of the line where it starts a comment (at a line's start, or after a space, `;`, `{` or `}`: never in `url(https://...)`). */
export function withoutComments(text: string, scss: boolean): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (scss) out = out.replace(/(^|[\s;{}])(\/\/[^\n]*)/g, (_, pre: string, c: string) => pre + blank(c));
  return out;
}

/** Each var() without a fallback written in a style source (SCSS or CSS), with its line and column. */
export function sourceVarUses(text: string, scss: boolean): VarUse[] {
  const clean = withoutComments(text, scss);
  return varUses(clean).map(u => ({ name: u.name, ...position(clean, u.offset) }));
}

/** The custom properties a `style` attribute's text sets. */
export function inlineProperties(style: string): string[] {
  try {
    const out: string[] = [];
    postcss.parse(`x{${style}}`).walkDecls(d => { if (NAME.test(d.prop)) out.push(d.prop); });
    return out;
  } catch {
    return [];
  }
}

/** A matcher for names and prefixes (`is-*`): true for a name one of `patterns` covers. */
export function nameMatcher(patterns: readonly string[]): (name: string) => boolean {
  const exact = new Set(patterns.filter(p => !p.endsWith("*")));
  const prefixes = patterns.filter(p => p.endsWith("*")).map(p => p.slice(0, -1));
  return name => exact.has(name) || prefixes.some(p => name.startsWith(p));
}
