// What a stylesheet says, for pd build's class check (class-check.ts): the classes its selectors name. Compiled CSS is
// read with postcss: what it names is what a browser gets, whatever Sass built it from.

import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

export interface CssVocabulary {
  classes: Set<string>;
}

/** The classes a selector names. */
export function selectorClassNames(selector: string): string[] {
  const out: string[] = [];
  try {
    selectorParser(root => { root.walkClasses(c => { out.push(c.value); }); }).processSync(selector);
  } catch { /* not a selector postcss-selector-parser reads: no classes from it */ }
  return out;
}

/** The classes of compiled CSS. */
export function readCss(text: string): CssVocabulary {
  const classes = new Set<string>();
  let root: postcss.Root;
  try {
    root = postcss.parse(text);
  } catch {
    return { classes };
  }
  root.walkRules(rule => { for (const c of selectorClassNames(rule.selector)) classes.add(c); });
  return { classes };
}

/** A matcher for names and prefixes (`is-*`): true for a name one of `patterns` covers. */
export function nameMatcher(patterns: readonly string[]): (name: string) => boolean {
  const exact = new Set(patterns.filter(p => !p.endsWith("*")));
  const prefixes = patterns.filter(p => p.endsWith("*")).map(p => p.slice(0, -1));
  return name => exact.has(name) || prefixes.some(p => name.startsWith(p));
}
