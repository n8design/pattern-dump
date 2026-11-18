// Symbol images: one SVG per symbol in an asset root's `symbols/` folder, shown on a storefront page by markdown
// (`![Alt](#stem)`, markdown.ts) through a hidden sprite that holds each symbol the page uses, once. Because a
// same-document <use> inherits the page's custom properties and `currentColor`, a symbol follows the site's colour
// tokens and its light and dark modes. `pd build` also writes each one as a standalone file (standaloneSvg), with the
// token values written in, for places that can show only an image file.
//
// A source is prepared before it is inlined into a page, because the page is the site's own document:
//
//   - colours only as `var(--color-*)`, `currentColor`, `none`, `transparent` or a `url(#…)` to its own paint
//     server: anything else is an error (Stylelint doesn't read SVG, so Pattern Dump checks it);
//   - a <style> may hold only simple class rules (`.box { fill: …; stroke: … }`) of presentation properties: each
//     becomes attributes on the elements with that class, and the <style> goes. Anything else in it is an error.
//     A <style> left in a page is a stylesheet for the whole page, and page CSS reaches elements inside a <use>,
//     so every `class` goes too;
//   - <script>, <foreignObject>, <image>, event attributes (`on…`) and an `href` that leaves the file are removed,
//     with one warning per file naming what was;
//   - <title> and <desc> go: the image's name is the alt text the page gives it;
//   - every id becomes `img-<stem>--<id>`, and every `url(#…)` and `href="#…"` with it, so two symbols on a page,
//     and a symbol and the page's own ids, never meet.
//
// Each file is prepared once per stat stamp (inode, size, modification time), as the image index keeps its entries
// (build/src/image-index.ts); `fresh` (pd build) reads every file again. When two asset roots have a symbol with
// the same stem, the first root's wins (the project's roots come before a package's), as a project's component wins
// over a package's of the same handle, and it is reported as information.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse, type HTMLElement } from "node-html-parser";
import postcss from "postcss";
import { svgSize } from "@pattern-dump/build";
import type { BaseTokens } from "./css-tokens.js";

/** The folder of an asset root that holds the symbols. */
export const SYMBOLS_FOLDER = "symbols";

/** A symbol's id in a page: never a heading's anchor shape alone (`img-` plus the stem). */
export const symbolId = (stem: string): string => `img-${stem}`;

/** A symbol ready to inline. */
export interface SymbolSource {
  stem: string;
  /** The source file. */
  file: string;
  viewBox: string;
  width: number;
  height: number;
  /** The prepared markup inside the source's root <svg>. */
  inner: string;
  /** Every id in `inner`, prefixed (the symbol's own id is symbolId(stem)). */
  ids: string[];
  /** The `--color-*` names it uses, in order of first use. */
  tokens: string[];
  usesCurrentColor: boolean;
  /** One line naming what was removed, when anything was. */
  warning?: string;
}

/** A source that can't be used, with every reason. */
export interface SymbolProblem { stem: string; file: string; problems: string[] }

export type SymbolEntry = { ok: true; source: SymbolSource } | { ok: false; problem: SymbolProblem };

export interface SymbolIndex {
  /** By stem: the first asset root's file. */
  readonly entries: ReadonlyMap<string, SymbolEntry>;
  /** Files hidden by a symbol of the same stem in an earlier asset root. */
  readonly shadowed: ReadonlyArray<{ stem: string; file: string; by: string }>;
}

export interface SymbolIndexer {
  index(assetRoots: readonly string[], options?: { fresh?: boolean }): Promise<SymbolIndex>;
}

const STEM = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function createSymbolIndexer(): SymbolIndexer {
  const known = new Map<string, { stamp: string; entry: SymbolEntry }>();
  return {
    async index(assetRoots, options = {}) {
      const entries = new Map<string, SymbolEntry>();
      const shadowed: { stem: string; file: string; by: string }[] = [];
      for (const root of assetRoots) {
        const dir = join(root, SYMBOLS_FOLDER);
        const names = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter(e => e.isFile() && /\.svg$/i.test(e.name)).map(e => e.name).sort();
        for (const name of names) {
          const stem = name.slice(0, -4);
          const file = join(dir, name);
          const earlier = entries.get(stem);
          if (earlier) {
            const by = earlier.ok ? earlier.source.file : earlier.problem.file;
            if (by !== file) shadowed.push({ stem, file, by });
            continue;
          }
          let s;
          try { s = await stat(file, { bigint: true }); } catch { continue; }
          const stamp = `${s.ino}:${s.size}:${s.mtimeNs}`;
          let cached = known.get(file);
          if (options.fresh || !cached || cached.stamp !== stamp) {
            const raw = await readFile(file, "utf8").catch(() => null);
            if (raw === null) continue;
            cached = { stamp, entry: prepareSymbol(stem, file, raw) };
            known.set(file, cached);
          }
          entries.set(stem, cached.entry);
        }
      }
      return { entries, shadowed };
    },
  };
}

const PRESENTATION = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity", "stop-color", "stop-opacity", "color",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing",
  "paint-order", "vector-effect", "flood-color", "flood-opacity", "lighting-color", "visibility", "display",
]);
const COLOUR_PROPS = new Set(["fill", "stroke", "stop-color", "color", "flood-color", "lighting-color"]);
const COLOUR_OK = /^(?:var\(\s*--color-[A-Za-z0-9_-]+\s*\)|currentColor|none|transparent|url\(\s*#[^)\s]+\s*\))$/i;
const REMOVED_ELEMENTS = new Set(["script", "foreignobject", "image"]);

/** A source, checked and prepared to inline (see the header), or why it can't be. */
export function prepareSymbol(stem: string, file: string, raw: string): SymbolEntry {
  const problems: string[] = [];
  const fail = (): SymbolEntry => ({ ok: false, problem: { stem, file, problems } });
  if (!STEM.test(stem)) {
    problems.push(`its name can't be a symbol's: use letters, digits, "-" and "_", starting with a letter or digit`);
    return fail();
  }
  const doc = parse(raw, { lowerCaseTagName: false, comment: false });
  const root = doc.querySelector("svg");
  if (!root) { problems.push("it has no <svg> element"); return fail(); }

  const removed: string[] = [];
  const note = (what: string): void => { if (!removed.includes(what)) removed.push(what); };
  const all = (): HTMLElement[] => root.querySelectorAll("*");

  // Removed before anything else reads the tree.
  for (const el of all()) {
    const tag = el.rawTagName.toLowerCase();
    if (REMOVED_ELEMENTS.has(tag)) { note(`<${el.rawTagName}>`); el.remove(); continue; }
    if (tag === "title" || tag === "desc") el.remove();
  }
  for (const el of [root, ...all()]) {
    for (const name of Object.keys(el.attributes)) {
      if (/^on/i.test(name)) { note(`${name} attributes`); el.removeAttribute(name); continue; }
      if ((name === "href" || name === "xlink:href") && !el.getAttribute(name)!.trim().startsWith("#")) {
        note(`an href that leaves the file (${el.getAttribute(name)!.trim()})`);
        el.removeAttribute(name);
      }
    }
  }

  // <style>: simple class rules become attributes.
  const classRules = new Map<string, Array<[string, string]>>();
  for (const style of root.querySelectorAll("style")) {
    let css: postcss.Root | undefined;
    try { css = postcss.parse(style.text); } catch (e) { problems.push(`its <style> isn't valid CSS: ${(e as Error).message}`); }
    css?.each(node => {
      if (node.type === "comment") return;
      if (node.type !== "rule" || !/^\.[A-Za-z_][\w-]*$/.test(node.selector.trim())) {
        problems.push(`its <style> may hold only simple class rules (.name { fill: … }), not ${node.toString().split("{")[0]!.trim() || node.toString().slice(0, 40)}`);
        return;
      }
      const decls: Array<[string, string]> = [];
      node.each(d => {
        if (d.type === "comment") return;
        if (d.type !== "decl" || !PRESENTATION.has(d.prop)) {
          problems.push(`its <style> rule ${node.selector.trim()} sets ${d.type === "decl" ? d.prop : "a nested rule"}, which isn't a presentation attribute`);
          return;
        }
        if (d.important) problems.push(`its <style> rule ${node.selector.trim()} uses !important`);
        decls.push([d.prop, d.value]);
      });
      const cls = node.selector.trim().slice(1);
      classRules.set(cls, [...classRules.get(cls) ?? [], ...decls]);
    });
    style.remove();
  }
  for (const el of all()) {
    const classes = el.getAttribute("class");
    if (classes === undefined) continue;
    for (const cls of classes.split(/\s+/).filter(Boolean)) {
      for (const [prop, value] of classRules.get(cls) ?? []) el.setAttribute(prop, value);
    }
    el.removeAttribute("class");
  }

  // Colours.
  const checkColour = (where: string, prop: string, value: string): void => {
    if (COLOUR_PROPS.has(prop) && !COLOUR_OK.test(value.trim())) {
      problems.push(`${where} ${prop}="${value.trim()}" is not a colour token: write var(--color-…) or currentColor (or none, transparent)`);
    }
  };
  for (const el of [root, ...all()]) {
    for (const [name, value] of Object.entries(el.attributes)) {
      if (name === "style") {
        for (const part of value.split(";")) {
          const i = part.indexOf(":");
          if (i > 0) checkColour(`<${el.rawTagName}> style:`, part.slice(0, i).trim().toLowerCase(), part.slice(i + 1));
        }
      } else checkColour(`<${el.rawTagName}>`, name, value);
    }
  }

  // Size: the source's width and height when absolute, else its viewBox's.
  const size = svgSize(root.toString());
  if (!size) problems.push("it has no viewBox and no width and height, so its size can't be known");
  if (problems.length) return fail();
  const viewBox = root.getAttribute("viewBox")?.trim() || `0 0 ${size!.width} ${size!.height}`;

  // Ids, and every reference to one.
  const prefix = `${symbolId(stem)}--`;
  const ids: string[] = [];
  for (const el of all()) {
    const id = el.getAttribute("id");
    if (id === undefined) continue;
    el.setAttribute("id", prefix + id);
    ids.push(prefix + id);
  }
  for (const el of all()) {
    for (const [name, value] of Object.entries(el.attributes)) {
      if (name === "id") continue;
      let next = value.replace(/url\(\s*#([^)\s]+)\s*\)/g, (_, id: string) => `url(#${prefix}${id})`);
      if ((name === "href" || name === "xlink:href") && next.trim().startsWith("#")) next = `#${prefix}${next.trim().slice(1)}`;
      if (next !== value) el.setAttribute(name, next);
    }
  }

  // The root's own presentation attributes (a `fill` every shape inherits) stay, on a group around its content.
  const rootAttrs = Object.entries(root.attributes).filter(([n]) => PRESENTATION.has(n) || n === "style");
  const content = root.innerHTML.trim();
  const inner = rootAttrs.length
    ? `<g ${rootAttrs.map(([n, v]) => `${n}="${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join(" ")}>${content}</g>`
    : content;
  const tokens = [...new Set([...inner.matchAll(/var\(\s*(--color-[A-Za-z0-9_-]+)\s*\)/g)].map(m => m[1]!))];
  return {
    ok: true,
    source: {
      stem, file, viewBox, width: size!.width, height: size!.height, inner, ids, tokens,
      usesCurrentColor: /currentColor/i.test(inner),
      ...(removed.length ? { warning: `removed ${removed.join(", ")}` } : {}),
    },
  };
}

/** A symbol as it goes into a page's sprite. */
export function symbolElement(s: SymbolSource): string {
  return `<symbol id="${symbolId(s.stem)}" viewBox="${s.viewBox}">${s.inner}</symbol>`;
}

/** The hidden sprite of a page: its symbols, once each, in the order given. Hidden by size, never display:none,
 *  which keeps markers and gradients inside it from painting in Chromium and WebKit. */
export function spriteMarkup(sources: readonly SymbolSource[]): string {
  if (!sources.length) return "";
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n`
    + sources.map(symbolElement).join("\n") + `\n</svg>`;
}

/**
 * A symbol as a file of its own, for an <img>: the token values written in, light, then dark in
 * `@media (prefers-color-scheme: dark)`, read from the base layer (`tokens`, css-tokens.ts). `currentColor` has no
 * text around it there, so it becomes `currentColorToken` (assets.symbols.currentColor). A token the base layer
 * doesn't have, or can't resolve, is a problem.
 */
export function standaloneSvg(s: SymbolSource, tokens: BaseTokens, currentColorToken: string): { svg: string } | { problems: string[] } {
  const inner = s.usesCurrentColor ? s.inner.replace(/currentColor/gi, `var(${currentColorToken})`) : s.inner;
  const used = s.usesCurrentColor && !s.tokens.includes(currentColorToken) ? [...s.tokens, currentColorToken] : s.tokens;
  const problems: string[] = [];
  for (const t of used) {
    if (tokens.tokens.has(t)) continue;
    const why = tokens.unresolved.get(t);
    const via = t === currentColorToken && !s.tokens.includes(t) ? ` (currentColor, assets.symbols.currentColor)` : "";
    problems.push(why ? `${t}${via} can't be resolved from the base layer: ${why}` : `${t}${via} is not in the base layer`);
  }
  if (problems.length) return { problems };
  const decls = (mode: "light" | "dark") => used.map(t => `${t}: ${tokens.tokens.get(t)![mode]};`).join(" ");
  const style = used.length
    ? `<style>:root { ${decls("light")} } @media (prefers-color-scheme: dark) { :root { ${decls("dark")} } }</style>`
    : "";
  const xlink = /\sxlink:/.test(inner) ? ` xmlns:xlink="http://www.w3.org/1999/xlink"` : "";
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg"${xlink} viewBox="${s.viewBox}" width="${s.width}" height="${s.height}">${style}${inner}</svg>\n` };
}
