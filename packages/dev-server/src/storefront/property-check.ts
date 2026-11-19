// Undefined custom properties: pd build fails on a var(--x) in the project's own style sources with no --x defined
// anywhere, naming file and line. Without the check it silently falls back to nothing, and a colour just goes
// missing on screen.
//
// - Checked: each var() without a fallback written in the project's styles folder (SCSS or CSS). A pattern
//   package's stylesheets are not the project's to fix, so they are not checked; what they define counts.
// - Defined: `--x:` or `@property --x` in any compiled stylesheet of the style guide (project and packages, its
//   base and themes), or in a stylesheet the site loads; `--x:` in a style attribute of any page or preview the
//   build writes; and storefront.checks.allowProperties, for what JavaScript sets.
// - var(--x, fallback) is fine: it says what to show without --x.

import { inlineProperties, nameMatcher, readCss, sourceVarUses } from "./css-vocabulary.js";

export interface PropertyCheckInput {
  /** The project's own style sources: path (as the message names it) and text. */
  sources: readonly { path: string; text: string }[];
  /** Every compiled stylesheet of the style guide, and every stylesheet the site loads. */
  stylesheets: readonly string[];
  /** Every document the build writes (pages, previews): their style attributes set properties too. */
  documents: readonly string[];
  /** storefront.checks.allowProperties. */
  allow?: readonly string[];
}

/** The properties `stylesheets` and `documents` define. */
export function definedProperties(stylesheets: readonly string[], documents: readonly string[]): Set<string> {
  const defined = new Set<string>();
  for (const css of stylesheets) for (const p of readCss(css).properties) defined.add(p);
  for (const html of documents) {
    for (const m of html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      for (const p of inlineProperties((m[1] ?? m[2] ?? "").replace(/&quot;/g, `"`).replace(/&amp;/g, "&"))) defined.add(p);
    }
  }
  return defined;
}

/** One line per use of an undefined property, by file and line: `styles/card.scss:4: var(--card-gap) ...`. */
export function checkProperties(input: PropertyCheckInput): string[] {
  const defined = definedProperties(input.stylesheets, input.documents);
  const allowed = nameMatcher(input.allow ?? []);
  const out: string[] = [];
  for (const s of input.sources) {
    for (const u of sourceVarUses(s.text, s.path.endsWith(".scss"))) {
      if (defined.has(u.name) || allowed(u.name)) continue;
      out.push(`${s.path}:${u.line}: var(${u.name}) reads a custom property nothing defines: define ${u.name} in the skin, `
        + `give it a fallback (var(${u.name}, ...)), or, if JavaScript sets it, list it in site.checks.allowProperties`);
    }
  }
  return out;
}
