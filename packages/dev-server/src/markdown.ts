// Docs Markdown rendering.
//
// SECURITY, load-bearing. The docs panel renders into the SHELL (the parent document), not the
// preview iframe, so this module is the boundary that keeps author markdown from becoming shell
// script. Two mechanisms, both configured on the singleton below and both easy to lose in a move:
//
//   `html: false`   — raw HTML in a .md is escaped, never injected.
//   `validateLink`  — a POSITIVE allowlist. Anything not http(s)/mailto/tel, not relative
//                     (`.` `#` `/`), and not `pattern:` is refused, so markdown-it emits no anchor
//                     at all and the source stays inert literal text.
//
// The `_md` singleton MUST travel with BOTH mutations. Moving it without the fence rule silently
// degrades every fence to a plain <pre>; without validateLink it silently opens `javascript:`.
// Guarded by test/docs.spec.ts, which asserts over HTTP and so is indifferent to where this lives.
//
// THE ONE DELIBERATE EXCEPTION is the `pattern` fence, which injects live rendered component HTML
// into the shell — the workbench self-trust boundary, marked at its emit site. `src-html` is its
// escaped twin. Do not "consistently" escape the pattern fence; that kills live embeds.
//
// Per-render state travels in markdown-it's `env` (the resolvedFences map), never on the singleton,
// which is what makes concurrent renders safe.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type MarkdownIt from "markdown-it";
import type { DiscoveryMap, ImageLookup } from "@pattern-dump/contracts";
import { imageTag, deepMerge, readExampleHeight, type ProseSlot } from "@pattern-dump/renderer";
import { codeBlock, createMarkdown, fenceLanguage, placeOf } from "./code-blocks.js";
import { escapeAttr, escapeHtml } from "./http-utils.js";
import { usePlacedTags, type PlacedBlock } from "./placed-tags.js";
import { placeBlock, type PlacementDeps } from "./storefront/placed.js";
import { regionLandmarks, type RegionChoice } from "./storefront/regions.js";
import type { TocAnchor } from "./storefront/toc.js";
import { readSchema, type PlacedProblem } from "./storefront/declared-values.js";
import type { PageHeading } from "./storefront/derived.js";
import { slug, Slugger } from "./storefront/slug.js";
import { isRelativePath, resolvePageImage } from "./storefront/page-images.js";
import { SYMBOLS_FOLDER, symbolId, type SymbolEntry, type SymbolSource } from "./symbols.js";

/**
 * How a doc's live examples are embedded.
 *  - "inline" (the workbench's docs panel): a `pattern` fence is the rendered component, in place;
 *    `pattern:` links go to the workbench route.
 *  - "frame" (a storefront page): a `pattern` fence is an iframe on the component's own preview
 *    document, with a link to it in the workbench beside it — the page styles only itself, never the
 *    component (the preview is its own document). `pattern:` links go to `workbenchUrl` (which ends
 *    with "/"). A component that does not exist is still marked in the page, and is also added to
 *    `problems`: a storefront page with a broken example or link is a page that fails to build.
 *    Every heading gets an `id` (its anchor, headingAnchors below), and when `headings` is passed each one
 *    is added to it, in document order. Inline mode sets no ids.
 */
export type DocEmbed =
  | { embed: "inline" }
  | {
    embed: "frame"; workbenchUrl: string; problems: string[]; placed?: DocPlacing; headings?: PageHeading[];
    /** The page's images, checked and written with their variants (proseImages below). Without it, as markdown writes them. */
    prose?: ProseImages;
    /** Ids the page already has besides its headings (its layout's): a heading's anchor never takes one. */
    takenIds?: string[];
    /** The page's symbol images (`![Alt](#stem)`, symbolImages below). Without it, `#` images are left as markdown
     *  writes them. */
    symbols?: SymbolImages;
  };

/**
 * Components placed with values (`pd-` tags, placed-tags.ts): on where a caller passes this, off
 * everywhere else (a `<pd-…>` is then escaped text, as any tag). `lineOffset` is the number of lines before
 * the body in its file (a page's frontmatter), so problems point into the file; they are collected here,
 * with their positions, and every tag that has one renders as a marker instead of the component.
 */
export interface DocPlacing {
  deps: PlacementDeps; lineOffset: number; problems: PlacedProblem[];
  /** The page's regions (regions.ts): where a component that names one goes. Without it every component is in the
   *  body. */
  regions?: DocRegions;
}

/** The regions of the page being rendered: the choice for each placed component, and what each region holds. */
export interface DocRegions {
  choose(region: string, what: string): RegionChoice;
  /** Each region's components' HTML, in the page's order. */
  filled: Map<string, string[]>;
  /** Set when the page places a <pd-toc>. */
  toc: boolean;
  /** The #anchors its <pd-toc>s link to, to be checked against the page's final headings. */
  tocAnchors: TocAnchor[];
}

/**
 * A storefront page's images (frame mode only; the workbench's docs keep markdown's own <img>). Every image needs a
 * non-blank alt: markdown can't say "decorative on purpose", so one that is goes in through a component, with
 * alt="". An image under /assets/ is looked up in the image index (ready for this render): a raster is written as
 * {{pd-image}} writes it (renderer's imageTag), in the slot the page's layout declares (x-pd-prose-images), lazy with
 * `sizes="auto, <sizes>"`, the first `eager` images from the assets at once with `<sizes>` alone; an SVG as one file
 * at its size. A raster with no slot, a path the index doesn't have and an image that can't be encoded are problems.
 * With a title and alone on its line (`![Alt](/assets/x.jpg "Caption")`) it is a <figure> with that <figcaption>, as a
 * symbol image is; in a line of text the title stays the <img>'s title. A sibling `<name>-dark.<ext>` in the assets
 * makes it a <picture> with a `(prefers-color-scheme: dark)` <source> in the same widths.
 * A relative path (`./shot.png`, `shot.png`, `../shared/diagram.svg`) is an image beside the pages (page-images.ts):
 * resolved against the page's folder, it must stay inside the pages folder, and is then looked up and written exactly
 * as one from the assets, under its absolute URL (`/guide/shot.png`). Any other image (remote) is left as markdown
 * writes it. Problems carry their line in the page's file.
 */
export interface ProseImages {
  layoutId: string;
  /** The layout's x-pd-prose-images, when it declares a valid one; what is wrong with it, when it is invalid. */
  slot?: ProseSlot;
  slotProblem?: string;
  lookup: ImageLookup;
  /** Lines before the body in its file (the frontmatter). */
  lineOffset: number;
  problems: Array<{ line: number; message: string }>;
  /** The page's path in the pages folder ("guide/setup.md"): a relative image is resolved against its folder
   *  (page-images.ts) and looked up at its absolute URL. Without it, a relative image is left as markdown writes it. */
  pagePath?: string;
}

/**
 * A storefront page's symbol images (frame mode): `![Alt](#stem)` is the symbol `stem` from an asset root's symbols/
 * folder (symbols.ts), drawn by a <use> of the page's sprite: `<svg class="doc-image" role="img" aria-label="Alt">`
 * at the source's size. With a title (`![Alt](#stem "Caption")`) it is a <figure> with that <figcaption>, which needs
 * the image alone in its paragraph. An empty alt, a stem with no symbol and a symbol that can't be used are problems,
 * with their line in the page's file. `used` receives each symbol the page draws, once, in the order first drawn.
 */
export interface SymbolImages {
  lookup(stem: string): SymbolEntry | undefined;
  lineOffset: number;
  problems: Array<{ line: number; message: string }>;
  used: SymbolSource[];
}

const INLINE: DocEmbed = { embed: "inline" };

/** A markdown-it inline rule, as its ruler holds it. */
type InlineRule = Parameters<MarkdownIt["inline"]["ruler"]["at"]>[1];

/** The docs parser: one configuration, with or without placed components. */
function createDocMarkdown(placing: boolean): MarkdownIt {
  const md = createMarkdown({ html: false, linkify: false });

  // Positive allowlist: block javascript:, data:, vbscript:, etc.
  // html: false already escapes raw HTML in source; this covers link/image hrefs.
  // pattern: is allowed through so the link resolver can intercept it below.
  // An image may also have a plain relative path with no scheme (`shot.png`, an image beside a site's page); a link
  // keeps the list above. `inImage` is set only while markdown-it's image rule runs, which is synchronous.
  let inImage = false;
  md.validateLink = (url: string) => {
    const t = url.trim();
    return /^(https?|mailto|tel):/i.test(t) || /^[.#/]/.test(t) || t.startsWith("pattern:") || (inImage && isRelativePath(t));
  };
  const inlineRules = (md.inline.ruler as unknown as { __rules__: Array<{ name: string; fn: InlineRule }> }).__rules__;
  const imageRule = inlineRules.find(r => r.name === "image")!.fn;
  md.inline.ruler.at("image", (state, silent) => {
    inImage = true;
    try { return imageRule(state, silent); } finally { inImage = false; }
  });

  // Fence rule set once at instance creation — reads pre-resolved HTML from env,
  // never mutates shared state during render, safe for parallel builds.
  md.renderer.rules["fence"] = (tokens, idx, _opts, env) => {
    const map = (env as { resolvedFences?: Map<number, string> }).resolvedFences;
    return map?.get(idx) ?? `${codeBlock(tokens[idx]?.content ?? "", fenceLanguage(tokens[idx]?.info ?? ""), placeOf(env))}\n`;
  };

  // A storefront page's image, written with its variants (proseImages), else as markdown writes it.
  const image = md.renderer.rules["image"]!;
  md.renderer.rules["image"] = (tokens, idx, opts, env, self) =>
    (tokens[idx]?.meta as { pdImage?: string } | null)?.pdImage ?? image(tokens, idx, opts, env, self);

  if (placing) {
    usePlacedTags(md);
    // The same: a placed component's HTML, resolved before rendering; a marker where it has problems.
    md.renderer.rules["pd_component"] = (_tokens, idx, _opts, env) =>
      (env as { resolvedPlaced?: Map<number, string> }).resolvedPlaced?.get(idx)
        ?? `<p class="doc-error">[component not placed: see the page's problems]</p>\n`;
  }
  return md;
}

const _md = createDocMarkdown(false);
const _mdPlaced = createDocMarkdown(true);



/**
 * A frame-mode example's variants, when its component has any: one link per variant, the base first
 * (`default`), each to that variant's own preview, with `aria-current` on the one the fence shows. With
 * scripting off a link opens that preview; a page's script may swap the frame's src in place instead.
 * Read from discovery, so it lists what exists; nothing when the component has no variants.
 */
function _frameVariants(compId: string, shown: string | undefined, discoveryMap: DiscoveryMap): string {
  const prefix = `${compId}~`;
  const variants = [...discoveryMap.keys()].filter(id => id.startsWith(prefix)).map(id => id.slice(prefix.length)).sort();
  if (variants.length === 0) return "";
  const items = [undefined, ...variants].map(v => {
    const id = v ? `${prefix}${v}` : compId;
    const current = v === shown ? ` aria-current="true"` : "";
    return `<li><a href="${escapeAttr(`/preview/${id}`)}"${current}>${escapeHtml(v ?? "default")}</a></li>\n`;
  });
  return `<ul class="doc-example-variants" aria-label="${escapeAttr(`Variants of ${compId}`)}">\n${items.join("")}</ul>\n`;
}

/** Shared parser for pattern specs used by both fence blocks and cross-links. */
function _parsePatternSpec(spec: string): { compId: string; variant?: string } {
  const tildeIdx = spec.indexOf("~");
  return {
    compId:  tildeIdx >= 0 ? spec.slice(0, tildeIdx) : spec,
    variant: tildeIdx >= 0 ? spec.slice(tildeIdx + 1) : undefined,
  };
}

/**
 * Walk inline token children, find link_open tokens with href="pattern:…",
 * and mutate them in-place before rendering. Resolved targets get class + data
 * attributes; unresolved targets get .pattern-link--unresolved + aria-disabled.
 * Variant validation is full: pattern:atoms/button~ghost is unresolved if
 * button~ghost is not in the discovery map.
 */
function _resolvePatternLinks(
  tokens: ReturnType<MarkdownIt["parse"]>,
  discoveryMap: DiscoveryMap,
  embed: DocEmbed
): void {
  for (const blockTok of tokens) {
    if (blockTok.type !== "inline" || !blockTok.children) continue;
    for (const child of blockTok.children) {
      if (child.type !== "link_open") continue;
      const href = child.attrGet("href") ?? "";
      if (!href.startsWith("pattern:")) continue;
      const { compId, variant } = _parsePatternSpec(href.slice("pattern:".length));
      // Check the full variant id — pattern:atoms/button~ghost is unresolved if
      // button~ghost isn't in the map (variant typos surface instead of falling back silently).
      const fullId = variant ? `${compId}~${variant}` : compId;
      if (discoveryMap.has(fullId)) {
        const base = embed.embed === "frame" ? embed.workbenchUrl : "/";
        child.attrSet("href", base + compId + (variant ? "#" + variant : ""));
        child.attrPush(["class", "pattern-link"]);
        child.attrPush(["data-pattern-id", compId]);
        if (variant) child.attrPush(["data-variant", variant]);
      } else {
        if (embed.embed === "frame") embed.problems.push(`pattern:${compId}${variant ? `~${variant}` : ""}: there is no such component`);
        child.attrSet("href", "#");
        child.attrPush(["class", "pattern-link--unresolved"]);
        child.attrPush(["aria-disabled", "true"]);
      }
    }
  }
}

export async function renderDoc(
  body: string,
  renderComponent: (id: string, variant?: string) => Promise<string>,
  discoveryMap: DiscoveryMap,
  embed: DocEmbed = INLINE
): Promise<string> {
  const placing = embed.embed === "frame" ? embed.placed : undefined;
  const md = placing ? _mdPlaced : _md;
  const tokens = md.parse(body, { pdLineOffset: placing?.lineOffset ?? 0 });

  // Resolve pattern: cross-links synchronously (discoveryMap.has is sync).
  _resolvePatternLinks(tokens, discoveryMap, embed);

  // `#stem` images: symbols on a storefront page, a marked error in the workbench's docs (not supported there yet).
  const symbols = embed.embed === "frame" ? embed.symbols : undefined;
  if (embed.embed === "inline" || symbols) symbolImages(md, tokens, symbols);
  if (embed.embed === "frame" && embed.prose) proseImages(md, tokens, embed.prose, symbols !== undefined);

  // Frame mode only (a storefront page): every heading gets its anchor as its id.
  if (embed.embed === "frame") {
    const headings = headingAnchors(tokens, embed.takenIds);
    embed.headings?.push(...headings);
  }

  // Resolve all fence tokens asynchronously — identification via markdown-it's tokenizer,
  // not a regex pre-scan (which breaks on indented fences, fences inside blockquotes, etc.).
  const resolvedFences = new Map<number, string>();
  await Promise.all(
    tokens.flatMap((tok, idx) =>
      tok.type === "fence" ? [_resolveFence(tok.info, tok.content, idx, renderComponent, resolvedFences, discoveryMap, embed)] : []
    )
  );

  // Placed components: each checked and rendered once through render(), its problems collected.
  const resolvedPlaced = new Map<number, string>();
  if (placing) {
    for (const [idx, tok] of tokens.entries()) {
      if (tok.type !== "pd_component") continue;
      const block = tok.meta as PlacedBlock;
      const r = await placeBlock(block, placing.deps, { headings: embed.embed === "frame" ? embed.headings ?? [] : [] });
      placing.problems.push(...r.problems);
      if (r.toc && placing.regions) { placing.regions.toc = true; placing.regions.tocAnchors.push(...r.tocAnchors ?? []); }
      if (r.html === undefined || r.problems.length) continue;
      // A component that names a region goes there, or nowhere when the page's layout hasn't that region.
      const choice = r.region !== undefined && placing.regions ? placing.regions.choose(r.region, r.regionFrom ?? "") : { to: "body" as const };
      if (choice.to === "body") { resolvedPlaced.set(idx, `${r.html}\n`); continue; }
      resolvedPlaced.set(idx, "");
      if (choice.to === "problem") { placing.problems.push({ at: block.root!.at, message: choice.message }); continue; }
      if (choice.to === "none") continue;
      const brought = regionLandmarks(r.html);
      if (brought.length) {
        placing.problems.push({ at: block.root!.at, message: `${r.regionFrom ?? `<${block.root!.name}>`}: what it renders would bring ${brought.join(" and ")} `
          + `into the region "${choice.region}": the page's landmarks are the layout's` });
        continue;
      }
      placing.regions!.filled.set(choice.region, [...placing.regions!.filled.get(choice.region) ?? [], r.html]);
    }
  }

  return md.renderer.render(tokens, md.options, { resolvedFences, resolvedPlaced, pdCodeBlocks: { storefront: embed.embed === "frame" } });
}

/**
 * `#stem` images (SymbolImages): with `symbols`, a storefront page's symbols; without (the workbench's docs), each is
 * a marked error, a paragraph of its own when the image is alone in one, else in place. Other images are left alone.
 */
function symbolImages(md: MarkdownIt, tokens: ReturnType<MarkdownIt["parse"]>, symbols: SymbolImages | undefined): void {
  for (const [bi, block] of tokens.entries()) {
    if (block.type !== "inline" || !block.children) continue;
    let line = (block.map?.[0] ?? 0) + 1 + (symbols?.lineOffset ?? 0);
    const alone = block.children.length === 1 && tokens[bi - 1]?.type === "paragraph_open" && tokens[bi + 1]?.type === "paragraph_close";
    const standAlone = (): void => { tokens[bi - 1]!.hidden = true; tokens[bi + 1]!.hidden = true; };
    for (const child of block.children) {
      if (child.type === "softbreak" || child.type === "hardbreak") { line++; continue; }
      if (child.type !== "image") continue;
      const src = child.attrGet("src") ?? "";
      if (!src.startsWith("#")) continue;
      const stem = src.slice(1);
      if (!symbols) {
        const text = `[image ${escapeHtml(src)} · symbol images show on site pages only, not in the workbench's docs yet]`;
        if (alone) standAlone();
        child.meta = { pdImage: alone ? `<p class="doc-error">${text}</p>\n` : `<span class="doc-error">${text}</span>` };
        continue;
      }
      const problem = (message: string) => symbols.problems.push({ line, message: `the image ${src}${message}` });
      const alt = md.renderer.renderInlineAsText(child.children ?? [], md.options, {});
      if (alt.trim() === "") {
        problem(` has no alt text: write what it shows between the brackets; a decorative image goes in through a component, with alt=""`);
        continue;
      }
      const entry = symbols.lookup(stem);
      if (!entry) { problem(` is not a symbol: there is no ${stem}.svg in an asset root's ${SYMBOLS_FOLDER}/ folder`); continue; }
      if (!entry.ok) { problem(`: ${SYMBOLS_FOLDER}/${stem}.svg can't be used: ${entry.problem.problems.join("; ")}`); continue; }
      const title = child.attrGet("title");
      if (title !== null && !alone) { problem(`: a caption needs the image on a line of its own`); continue; }
      const s = entry.source;
      if (!symbols.used.includes(s)) symbols.used.push(s);
      const svg = `<svg class="doc-image" role="img" aria-label="${escapeAttr(alt)}" viewBox="${escapeAttr(s.viewBox)}" `
        + `width="${s.width}" height="${s.height}"><use href="#${symbolId(s.stem)}"/></svg>`;
      if (title === null) { child.meta = { pdImage: svg }; continue; }
      standAlone();
      child.meta = { pdImage: `<figure class="doc-figure">\n${svg}\n<figcaption>${escapeHtml(title)}</figcaption>\n</figure>\n` };
    }
  }
}

/** Checks a storefront page's images and resolves the markup of those from the assets (ProseImages). `#` images are
 *  the symbol pass's when `symbolsOwnFragments`. */
function proseImages(md: MarkdownIt, tokens: ReturnType<MarkdownIt["parse"]>, prose: ProseImages, symbolsOwnFragments = false): void {
  let eager = prose.slot?.eager ?? 0;
  for (const [bi, block] of tokens.entries()) {
    if (block.type !== "inline" || !block.children) continue;
    let line = (block.map?.[0] ?? 0) + 1 + prose.lineOffset;
    // An image alone in its paragraph, as for a symbol image: with a title, a <figure> in place of the paragraph.
    const alone = block.children.length === 1 && tokens[bi - 1]?.type === "paragraph_open" && tokens[bi + 1]?.type === "paragraph_close";
    for (const child of block.children) {
      if (child.type === "softbreak" || child.type === "hardbreak") { line++; continue; }
      if (child.type !== "image") continue;
      const src = child.attrGet("src") ?? "";
      if (symbolsOwnFragments && src.startsWith("#")) continue;
      const problem = (message: string) => prose.problems.push({ line, message: `the image ${src}${message}` });
      const alt = md.renderer.renderInlineAsText(child.children ?? [], md.options, {});
      if (alt.trim() === "") {
        problem(` has no alt text: write what it shows between the brackets; a decorative image goes in through a component, with alt=""`);
        continue;
      }
      // An image beside the pages: at its absolute URL from here on.
      let url = src;
      let beside: string | undefined;
      if (prose.pagePath !== undefined && isRelativePath(src)) {
        const resolved = resolvePageImage(src, prose.pagePath);
        if (!resolved.ok) {
          problem(` is outside the pages folder: a relative image stays inside site.pagesDir (an image from elsewhere goes in the assets, as /assets/…)`);
          continue;
        }
        url = resolved.url;
        beside = resolved.rel;
      } else if (!src.startsWith("/assets/")) continue;
      const source = prose.lookup(url);
      if (!source) { problem(beside !== undefined ? ` is not beside the page: there is no ${beside} in the pages folder` : ` is not an image in the assets`); continue; }
      if (source.kind === "unavailable") { problem(`: ${source.reason}`); continue; }
      if (source.kind === "variants" && !prose.slot) {
        problem(` needs its layout's slot for prose images: ${prose.layoutId} `
          + (prose.slotProblem ? `has an invalid x-pd-prose-images (${prose.slotProblem})` : `declares no x-pd-prose-images`));
        continue;
      }
      // A sibling <name>-dark.<ext> is the image in dark mode: a <picture> with a (prefers-color-scheme: dark) source.
      const darkSrc = /-dark\.[^./]+$/.test(url) ? undefined : url.replace(/(\.[^./]+)$/, "-dark$1");
      const dark = darkSrc !== undefined && darkSrc !== url ? prose.lookup(darkSrc) : undefined;
      if (dark?.kind === "unavailable") { problem(`: its dark version ${darkSrc} can't be used: ${dark.reason}`); continue; }
      const title = child.attrGet("title");
      const figure = title !== null && alone;
      const atOnce = eager > 0;
      if (atOnce) eager--;
      const slot = prose.slot;
      const tag = imageTag(source, {
        widths: slot?.widths ?? [], sizes: slot ? (atOnce ? slot.sizes : `auto, ${slot.sizes}`) : "",
        alt, eager: atOnce, settings: "site", ...(title !== null && !figure ? { title } : {}), ...(dark ? { dark } : {}),
      });
      if (!figure) { child.meta = { pdImage: tag }; continue; }
      tokens[bi - 1]!.hidden = true;
      tokens[bi + 1]!.hidden = true;
      child.meta = { pdImage: `<figure class="doc-figure">\n${tag}\n<figcaption>${escapeHtml(title)}</figcaption>\n</figure>\n` };
    }
  }
}

/** The text a heading reads as: its text and inline code; emphasis and link text kept, markup dropped. */
function headingText(inline: { children: { type: string; content: string }[] | null } | undefined): string {
  return (inline?.children ?? [])
    .filter(c => c.type === "text" || c.type === "text_special" || c.type === "code_inline")
    .map(c => c.content)
    .join("");
}

/**
 * Sets an `id` on every heading, h1 to h6, and returns them in document order: the anchor is the
 * GitHub slug of its text (slug.ts), deduplicated across the page; a heading whose slug is empty (only
 * emoji, say) is `section`, deduplicated like any other. An id in `taken` counts as given out already.
 */
function headingAnchors(tokens: ReturnType<MarkdownIt["parse"]>, taken: string[] = []): PageHeading[] {
  const slugger = new Slugger(taken);
  const headings: PageHeading[] = [];
  for (const [i, tok] of tokens.entries()) {
    if (tok.type !== "heading_open") continue;
    const text = headingText(tokens[i + 1]);
    const anchor = slugger.slug(slug(text) === "" ? "section" : text);
    tok.attrSet("id", anchor);
    headings.push({ level: Number(tok.tag.slice(1)), text, anchor });
  }
  return headings;
}

// renderer throws "[renderer] Component not found: ..." / "[renderer] Variant not found: ..." for
// missing components — expected content conditions (author typo, demo fences). Anything else is
// a real renderer bug that warrants a signal.
function _isRendererNotFound(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith("[renderer]") && e.message.includes("not found");
}

async function _resolveFence(
  info: string,
  content: string,
  idx: number,
  renderComponent: (id: string, variant?: string) => Promise<string>,
  out: Map<number, string>,
  discoveryMap: DiscoveryMap,
  embed: DocEmbed
): Promise<void> {
  const lang = info.trim();
  const code = content;

  if (lang === "pattern" || lang.startsWith("pattern ")) {
    const spec = lang.startsWith("pattern ") ? lang.slice("pattern ".length).trim() : code.split("\n")[0]?.trim() ?? "";
    if (!spec) { out.set(idx, `<pre><code></code></pre>`); return; }
    const { compId, variant } = _parsePatternSpec(spec);
    if (embed.embed === "frame") {
      // The component's own preview document, addressed by its id (a variant by `<base>~<variant>`,
      // the form a static host can serve), and a way into the workbench beside it that works with
      // scripting off. Nothing of the component is rendered into the page itself.
      const fullId = variant ? `${compId}~${variant}` : compId;
      if (!discoveryMap.has(fullId)) {
        embed.problems.push(`pattern ${spec}: there is no such component`);
        out.set(idx, `<p class="doc-error">[pattern: ${escapeHtml(spec)} · no such component]</p>`);
        return;
      }
      // The height the frame starts at, before its preview reports its own: the base component's declared
      // x-pd-example-height, one value for every variant. As an attribute, so it holds without script and a
      // skin's CSS can still override it. An invalid value fails the page, as a missing component does.
      // A schema that can't be read fails the page too: what it declares is unknown.
      const schemaPath = discoveryMap.get(compId)?.schemaPath;
      const read = await readSchema(schemaPath);
      const shown = embed.placed?.deps.shown ?? basename;
      if (read.error !== undefined) {
        embed.problems.push(`pattern ${spec}: its schema (${shown(schemaPath!)}) cannot be read: ${read.error}`);
        out.set(idx, `<p class="doc-error">[pattern: ${escapeHtml(spec)} · its schema cannot be read]</p>`);
        return;
      }
      const declared = readExampleHeight(read.schema);
      if (declared.problem) {
        embed.problems.push(`pattern ${spec}: its schema (${shown(schemaPath!)}, #/x-pd-example-height): ${declared.problem}`);
        out.set(idx, `<p class="doc-error">[pattern: ${escapeHtml(spec)} · invalid x-pd-example-height]</p>`);
        return;
      }
      const height = declared.height === undefined ? "" : ` height="${declared.height}"`;
      const workbench = embed.workbenchUrl + compId + (variant ? `#${variant}` : "");
      out.set(idx, `<figure class="doc-example">\n`
        + `<iframe src="${escapeAttr(`/preview/${fullId}`)}" title="${escapeAttr(fullId)}" loading="lazy"${height}></iframe>\n`
        + _frameVariants(compId, variant, discoveryMap)
        + `<figcaption><span class="doc-example-id">${escapeHtml(fullId)}</span> <a href="${escapeAttr(workbench)}">Open ${escapeHtml(fullId)} in the workbench</a></figcaption>\n`
        + `</figure>\n`);
      return;
    }
    try {
      const html = await renderComponent(compId, variant);
      // WORKBENCH SELF-TRUST BOUNDARY: pattern embeds inject rendered component HTML into the
      // shell. Safe for an author's own design system. Intersects the deferred public-preview /
      // CSP gate — externally-sourced package docs with pattern embeds change the calculus.
      out.set(idx, `<div class="doc-example">${html}</div>`);
    } catch (e) {
      if (!_isRendererNotFound(e)) console.warn(`[dev-server] Pattern block render error [${spec}]:`, e);
      out.set(idx, `<p class="doc-error">[pattern: ${escapeHtml(spec)} · render error]</p>`);
    }
    return;
  }

  if (lang === "src-template" || lang.startsWith("src-template ")) {
    const spec = lang.startsWith("src-template ") ? lang.slice("src-template ".length).trim() : code.split("\n")[0]?.trim() ?? "";
    if (!spec) { out.set(idx, codeBlock("", "", { storefront: embed.embed === "frame" })); return; }
    const { compId } = _parsePatternSpec(spec);  // variant ignored — all variants share the base template
    const entry = discoveryMap.get(compId);
    if (!entry?.hbsPath) {
      out.set(idx, `<p class="doc-error">[src-template: ${escapeHtml(spec)} · no template file]</p>`);
      return;
    }
    try {
      const src = await readFile(entry.hbsPath, "utf-8");
      out.set(idx, codeBlock(src, "handlebars", { storefront: embed.embed === "frame" }));
    } catch (e) {
      console.warn(`[dev-server] src-template read error [${spec}]:`, e);
      out.set(idx, `<p class="doc-error">[src-template: ${escapeHtml(spec)} · read error]</p>`);
    }
    return;
  }

  if (lang === "src-data" || lang.startsWith("src-data ")) {
    const spec = lang.startsWith("src-data ") ? lang.slice("src-data ".length).trim() : code.split("\n")[0]?.trim() ?? "";
    if (!spec) { out.set(idx, codeBlock("", "", { storefront: embed.embed === "frame" })); return; }
    const { compId, variant } = _parsePatternSpec(spec);
    const lookupId = variant ? `${compId}~${variant}` : compId;
    try {
      if (variant) {
        // Resolved context: base defaults merged with variant layer — the same context renderComponent renders from.
        const variantEntry = discoveryMap.get(lookupId);
        if (!variantEntry) {
          out.set(idx, `<p class="doc-error">[src-data: ${escapeHtml(spec)} · unknown variant]</p>`);
          return;
        }
        const baseJsonPath    = discoveryMap.get(compId)?.jsonPath;
        const variantJsonPath = variantEntry.jsonPath;
        const baseData: Record<string, unknown>    = baseJsonPath    ? JSON.parse(await readFile(baseJsonPath,    "utf-8")) : {};
        const variantData: Record<string, unknown> = variantJsonPath ? JSON.parse(await readFile(variantJsonPath, "utf-8")) : {};
        const merged = deepMerge(structuredClone(baseData), variantData);
        const src = JSON.stringify(merged, null, 2);
        out.set(idx, codeBlock(src, "json", { storefront: embed.embed === "frame" }));
      } else {
        // Base component: no parent to merge from — show its own data file as-is.
        const jsonPath = discoveryMap.get(compId)?.jsonPath;
        if (!jsonPath) {
          out.set(idx, `<p class="doc-error">[src-data: ${escapeHtml(spec)} · no data file]</p>`);
          return;
        }
        const src = await readFile(jsonPath, "utf-8");
        out.set(idx, codeBlock(src, "json", { storefront: embed.embed === "frame" }));
      }
    } catch (e) {
      console.warn(`[dev-server] src-data read error [${spec}]:`, e);
      out.set(idx, `<p class="doc-error">[src-data: ${escapeHtml(spec)} · read error]</p>`);
    }
    return;
  }

  if (lang === "src-html" || lang.startsWith("src-html ")) {
    const spec = lang.startsWith("src-html ") ? lang.slice("src-html ".length).trim() : code.split("\n")[0]?.trim() ?? "";
    if (!spec) { out.set(idx, codeBlock("", "", { storefront: embed.embed === "frame" })); return; }
    const { compId, variant } = _parsePatternSpec(spec);
    try {
      const html = await renderComponent(compId, variant);
      out.set(idx, codeBlock(html, "html", { storefront: embed.embed === "frame" }));
    } catch (e) {
      if (!_isRendererNotFound(e)) console.warn(`[dev-server] src-html render error [${spec}]:`, e);
      out.set(idx, `<p class="doc-error">[src-html: ${escapeHtml(spec)} · render error]</p>`);
    }
    return;
  }

  out.set(idx, codeBlock(code, lang, { storefront: embed.embed === "frame" }));
}
