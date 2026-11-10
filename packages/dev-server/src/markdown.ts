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
import MarkdownIt from "markdown-it";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { highlight, wrapWithCopyButton, deepMerge } from "@pattern-dump/renderer";
import { escapeAttr, escapeHtml } from "./http-utils.js";
import { usePlacedTags, type PlacedBlock } from "./placed-tags.js";
import { placeBlock, type PlacementDeps } from "./storefront/placed.js";
import type { PlacedProblem } from "./storefront/declared-values.js";
import type { PageHeading } from "./storefront/derived.js";
import { slug, Slugger } from "./storefront/slug.js";

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
    /** Ids the page already has besides its headings (its layout's): a heading's anchor never takes one. */
    takenIds?: string[];
  };

/**
 * Components placed with values (`pd-` tags, placed-tags.ts): on where a caller passes this, off
 * everywhere else (a `<pd-…>` is then escaped text, as any tag). `lineOffset` is the number of lines before
 * the body in its file (a page's frontmatter), so problems point into the file; they are collected here,
 * with their positions, and every tag that has one renders as a marker instead of the component.
 */
export interface DocPlacing { deps: PlacementDeps; lineOffset: number; problems: PlacedProblem[] }

const INLINE: DocEmbed = { embed: "inline" };

/** The docs parser: one configuration, with or without placed components. */
function createDocMarkdown(placing: boolean): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: false });

  // Positive allowlist: block javascript:, data:, vbscript:, etc.
  // html: false already escapes raw HTML in source; this covers link/image hrefs.
  // pattern: is allowed through so the link resolver can intercept it below.
  md.validateLink = (url: string) => {
    const t = url.trim();
    return /^(https?|mailto|tel):/i.test(t) || /^[.#/]/.test(t) || t.startsWith("pattern:");
  };

  // Fence rule set once at instance creation — reads pre-resolved HTML from env,
  // never mutates shared state during render, safe for parallel builds.
  md.renderer.rules["fence"] = (tokens, idx, _opts, env) => {
    const map = (env as { resolvedFences?: Map<number, string> }).resolvedFences;
    return map?.get(idx) ?? _mdPlainPre(tokens[idx]?.content ?? "");
  };

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

function _mdPlainPre(code: string): string {
  return `<pre><code>${escapeHtml(code)}</code></pre>`;
}


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
      const r = await placeBlock(tok.meta as PlacedBlock, placing.deps);
      placing.problems.push(...r.problems);
      if (r.html !== undefined && r.problems.length === 0) resolvedPlaced.set(idx, `${r.html}\n`);
    }
  }

  return md.renderer.render(tokens, md.options, { resolvedFences, resolvedPlaced });
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
        out.set(idx, `<p class="doc-error">[pattern: ${escapeHtml(spec)} — no such component]</p>`);
        return;
      }
      const workbench = embed.workbenchUrl + compId + (variant ? `#${variant}` : "");
      out.set(idx, `<figure class="doc-example">\n`
        + `<iframe src="${escapeAttr(`/preview/${fullId}`)}" title="${escapeAttr(fullId)}" loading="lazy"></iframe>\n`
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
      out.set(idx, `<p class="doc-error">[pattern: ${escapeHtml(spec)} — render error]</p>`);
    }
    return;
  }

  if (lang === "src-template" || lang.startsWith("src-template ")) {
    const spec = lang.startsWith("src-template ") ? lang.slice("src-template ".length).trim() : code.split("\n")[0]?.trim() ?? "";
    if (!spec) { out.set(idx, _mdPlainPre("")); return; }
    const { compId } = _parsePatternSpec(spec);  // variant ignored — all variants share the base template
    const entry = discoveryMap.get(compId);
    if (!entry?.hbsPath) {
      out.set(idx, `<p class="doc-error">[src-template: ${escapeHtml(spec)} — no template file]</p>`);
      return;
    }
    try {
      const src = await readFile(entry.hbsPath, "utf-8");
      out.set(idx, wrapWithCopyButton(highlight(src, "handlebars"), src));
    } catch (e) {
      console.warn(`[dev-server] src-template read error [${spec}]:`, e);
      out.set(idx, `<p class="doc-error">[src-template: ${escapeHtml(spec)} — read error]</p>`);
    }
    return;
  }

  if (lang === "src-data" || lang.startsWith("src-data ")) {
    const spec = lang.startsWith("src-data ") ? lang.slice("src-data ".length).trim() : code.split("\n")[0]?.trim() ?? "";
    if (!spec) { out.set(idx, _mdPlainPre("")); return; }
    const { compId, variant } = _parsePatternSpec(spec);
    const lookupId = variant ? `${compId}~${variant}` : compId;
    try {
      if (variant) {
        // Resolved context: base defaults merged with variant layer — the same context renderComponent renders from.
        const variantEntry = discoveryMap.get(lookupId);
        if (!variantEntry) {
          out.set(idx, `<p class="doc-error">[src-data: ${escapeHtml(spec)} — unknown variant]</p>`);
          return;
        }
        const baseJsonPath    = discoveryMap.get(compId)?.jsonPath;
        const variantJsonPath = variantEntry.jsonPath;
        const baseData: Record<string, unknown>    = baseJsonPath    ? JSON.parse(await readFile(baseJsonPath,    "utf-8")) : {};
        const variantData: Record<string, unknown> = variantJsonPath ? JSON.parse(await readFile(variantJsonPath, "utf-8")) : {};
        const merged = deepMerge(structuredClone(baseData), variantData);
        const src = JSON.stringify(merged, null, 2);
        out.set(idx, wrapWithCopyButton(highlight(src, "json"), src));
      } else {
        // Base component: no parent to merge from — show its own data file as-is.
        const jsonPath = discoveryMap.get(compId)?.jsonPath;
        if (!jsonPath) {
          out.set(idx, `<p class="doc-error">[src-data: ${escapeHtml(spec)} — no data file]</p>`);
          return;
        }
        const src = await readFile(jsonPath, "utf-8");
        out.set(idx, wrapWithCopyButton(highlight(src, "json"), src));
      }
    } catch (e) {
      console.warn(`[dev-server] src-data read error [${spec}]:`, e);
      out.set(idx, `<p class="doc-error">[src-data: ${escapeHtml(spec)} — read error]</p>`);
    }
    return;
  }

  if (lang === "src-html" || lang.startsWith("src-html ")) {
    const spec = lang.startsWith("src-html ") ? lang.slice("src-html ".length).trim() : code.split("\n")[0]?.trim() ?? "";
    if (!spec) { out.set(idx, _mdPlainPre("")); return; }
    const { compId, variant } = _parsePatternSpec(spec);
    try {
      const html = await renderComponent(compId, variant);
      out.set(idx, wrapWithCopyButton(highlight(html, "html"), html));
    } catch (e) {
      if (!_isRendererNotFound(e)) console.warn(`[dev-server] src-html render error [${spec}]:`, e);
      out.set(idx, `<p class="doc-error">[src-html: ${escapeHtml(spec)} — render error]</p>`);
    }
    return;
  }

  const highlighted = highlight(code, lang);
  out.set(idx, wrapWithCopyButton(highlighted, code));
}
