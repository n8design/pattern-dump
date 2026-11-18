// The class check: pd build reports each class on a site page that nothing in the style guide defines, so
// improvising outside the design system shows (by a person or an agent): the HTML counterpart of the schema checks.
//
// - Defined: a class any stylesheet of the style guide names in a selector (project and packages, compiled, and
//   each stylesheet the site loads), a class any component template writes (the static words of a class="...", and
//   the family it builds from a value: `doc-toc-h{{level}}` is every "doc-toc-h..." class), and a class the page's own
//   <style> names. A class a template writes is part of that component, styled or not: a skin may keep its markup
//   plain on purpose. What is left is a class that arrives whole from a value (`class="{{look}}"`, a page's
//   `look="hero-big-title"`), which no part of the system wrote: a page's markdown can't write HTML of its own.
// - Allowed: state classes JavaScript adds (is-, has-, js-), the classes Pattern Dump's own tooling writes into a
//   page (PD_CLASSES), and storefront.checks.allowClasses.
// - Where: the page's markdown file and line when the class is written there; else the file alone (it came from a
//   value, such as frontmatter a template writes), or the route for a page with no file (a tag or category page).
// - A warning by default; storefront.checks.classes: "error" stops the build, "off" skips the check.

import { nameMatcher, readCss } from "./css-vocabulary.js";

/** State classes, which JavaScript adds and takes away. */
export const STATE_CLASSES: readonly string[] = ["is-*", "has-*", "js-*"];

/** The classes Pattern Dump writes into a site page itself: code highlighting (shiki, its themes and lines) and its
 *  copy button, pattern links, live examples and their errors, symbol images and their figures, and its own problem
 *  lists. */
export const PD_CLASSES: readonly string[] = [
  "shiki", "shiki-*", "__shiki_*", "line", "copy-btn", "pd-*",
  "pattern-link", "pattern-link--unresolved",
  "doc-example", "doc-example-id", "doc-example-variants", "doc-error", "doc-image", "doc-figure",
];

/** The classes a template writes: each static word of a class="...", and the families it builds from a value, by the
 *  static start of the word (`doc-toc-h{{level}}` builds every class starting with "doc-toc-h"). A word an
 *  expression starts (`{{prefix}}-item`) names no class of its own. */
export function templateClasses(source: string): { classes: string[]; prefixes: string[] } {
  const classes = new Set<string>(), prefixes = new Set<string>();
  const EXPR = "\u0000";
  for (const m of source.matchAll(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    // A block's tags ({{#if}}, {{else}}, {{/if}}) only choose words, so they part them; any other expression is a value.
    const words = (m[1] ?? m[2] ?? "").replace(/\{\{~?\s*(?:[#/^]|else\b)[\s\S]*?\}\}/g, " ").replace(/\{\{[\s\S]*?\}\}/g, EXPR);
    for (const word of words.split(/\s+/)) {
      if (!word || word.startsWith(EXPR)) continue;
      if (!word.includes(EXPR)) classes.add(word);
      else prefixes.add(word.slice(0, word.indexOf(EXPR)));
    }
  }
  return { classes: [...classes], prefixes: [...prefixes] };
}

/** The classes on the elements of a built page, in order of first use. Scripts and comments are not markup. */
export function documentClasses(html: string): string[] {
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const out = new Set<string>();
  for (const m of markup.matchAll(/<[a-z][^>]*?\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const word of (m[1] ?? m[2] ?? "").split(/\s+/)) if (word) out.add(word.replace(/&amp;/g, "&"));
  }
  return [...out];
}

/** The text of the page's own <style> blocks. */
const styleBlocks = (html: string): string[] => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]!);

export interface ClassCheckPage {
  route: string;
  html: string;
  /** The page's markdown file (path in the pages folder, and its text); absent for a generated page. */
  file?: { path: string; text: string };
}

export interface ClassCheckInput {
  pages: readonly ClassCheckPage[];
  /** Every compiled stylesheet of the style guide, and every stylesheet the site loads. */
  stylesheets: readonly string[];
  /** Every component template's source. */
  templates: readonly string[];
  /** storefront.checks.allowClasses. */
  allow?: readonly string[];
}

/** The line of `text` (1-based) that writes `name` as a word, in a class attribute if one does; else null. */
function lineOf(text: string, name: string): number | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^\\w-])${escaped}(?![\\w-])`);
  const lines = text.split("\n");
  const inClass = lines.findIndex(l => /\bclass\s*=/.test(l) && word.test(l));
  if (inClass >= 0) return inClass + 1;
  const any = lines.findIndex(l => word.test(l));
  return any >= 0 ? any + 1 : null;
}

/** One line per class a page uses and nothing defines, in page order: `about.md:12: class "x" isn't defined by any
 *  component or style`. */
export function checkClasses(input: ClassCheckInput): string[] {
  const defined = new Set<string>();
  for (const css of input.stylesheets) for (const c of readCss(css).classes) defined.add(c);
  const families: string[] = [];
  for (const t of input.templates) {
    const written = templateClasses(t);
    for (const c of written.classes) defined.add(c);
    families.push(...written.prefixes.map(p => `${p}*`));
  }
  const allowed = nameMatcher([...STATE_CLASSES, ...PD_CLASSES, ...families, ...(input.allow ?? [])]);
  const out: string[] = [];
  for (const page of input.pages) {
    const own = new Set<string>();
    for (const css of styleBlocks(page.html)) for (const c of readCss(css).classes) own.add(c);
    for (const name of documentClasses(page.html)) {
      if (defined.has(name) || own.has(name) || allowed(name)) continue;
      const line = page.file ? lineOf(page.file.text, name) : null;
      const where = page.file ? `${page.file.path}${line !== null ? `:${line}` : ""}` : page.route;
      out.push(`${where}: class "${name}" isn't defined by any component or style`);
    }
  }
  return out;
}
