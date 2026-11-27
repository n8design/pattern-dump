// The stylesheets Sass never compiles, read for their classes: the project's `assets.css` files and a template's own
// `<style>` elements. Each is read as plain CSS, with the same rule as the style index (selectorClasses: a
// context-free compound defines a class, any other appearance mentions it), so the graph has their edges too. A
// stylesheet on another host (an `assets.css` URL, a template's own `<link>`) is never fetched: it is only named, so
// an answer can say what it can't see into.

import postcss from "postcss";
import { PD_ROUTE_PREFIX } from "@pattern-dump/contracts";
import { assetFile } from "./asset-file.js";
import { selectorClasses } from "./style-index.js";

/** The classes a stylesheet's rules define and mention, each with the first selector that names it, sorted by class.
 *  A class the sheet defines is no mention of its own. */
export interface SheetClasses {
  defines: Map<string, string>;
  mentions: Map<string, string>;
}

const byName = (m: Map<string, string>): Map<string, string> =>
  new Map([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** The classes of a plain CSS text, read from `from` (a file, named so: without it PostCSS names the input with a random
 *  id, drawn from Math.random, which would move a project helper's seeded sequence). Text that doesn't parse gives
 *  none: what can't be read defines nothing. */
export function cssTextClasses(css: string, from: string): SheetClasses {
  const defines = new Map<string, string>();
  const mentions = new Map<string, string>();
  let root: postcss.Root;
  try { root = postcss.parse(css, { from }); } catch { return { defines, mentions }; }
  root.walkRules(rule => {
    const found = selectorClasses(rule.selector);
    for (const name of found.defines) if (!defines.has(name)) defines.set(name, rule.selector);
    for (const name of found.mentions) if (!mentions.has(name)) mentions.set(name, rule.selector);
  });
  for (const name of defines.keys()) mentions.delete(name);
  return { defines: byName(defines), mentions: byName(mentions) };
}

/** The text of each `<style>` element in a template, in order. A Handlebars expression inside is blanked to spaces of
 *  its length, so a rule around it still parses and a rule made of one names nothing. */
export function inlineStyleTexts(hbs: string): string[] {
  return [...hbs.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map(m => m[1]!.replace(/\{\{[\s\S]*?\}\}/g, expr => " ".repeat(expr.length)));
}

/** The classes of all of a template's `<style>` elements together (the template is `from`), or null when it has none. */
export function inlineStyleClasses(hbs: string, from: string): SheetClasses | null {
  const texts = inlineStyleTexts(hbs);
  return texts.length === 0 ? null : cssTextClasses(texts.join("\n"), from);
}

/** The stylesheets a template links itself (`<link rel="stylesheet" href>`), as written, sorted. A link whose
 *  address is a Handlebars expression is left out: there is no address to name. */
export function linkedStylesheets(hbs: string): string[] {
  const hrefs = new Set<string>();
  for (const [tag] of hbs.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = href?.[1] ?? href?.[2] ?? href?.[3];
    if (value && !value.includes("{{")) hrefs.add(value);
  }
  return [...hrefs].sort();
}

/** One `assets.css` entry: read from its file in the asset folders, or (a URL, or a path to no file) only named. */
export type AssetStylesheet =
  | { entry: string; file: string; classes: SheetClasses }
  | { entry: string; file: null };

/** The project's `assets.css` entries, in the order the preview links them. A path is looked up as the asset route
 *  serves it (asset-file.ts); a URL is never fetched. */
export async function readAssetStylesheets(
  entries: readonly string[], roots: readonly string[], names: readonly string[],
  read: (file: string) => Promise<string>,
): Promise<AssetStylesheet[]> {
  const out: AssetStylesheet[] = [];
  for (const entry of entries) {
    const file = entry.includes("://") ? null : await assetFile(`${PD_ROUTE_PREFIX.assets}${encodeURI(entry)}`, roots, names);
    if (!file) { out.push({ entry, file: null }); continue; }
    let text: string;
    try { text = await read(file); } catch { out.push({ entry, file: null }); continue; }
    out.push({ entry, file, classes: cssTextClasses(text, file) });
  }
  return out;
}
