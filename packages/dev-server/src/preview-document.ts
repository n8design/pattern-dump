// Preview-document composition.
//
// THE HONEST-UA-PAGE CONTRACT LIVES HERE. The shell injects nothing into the preview beyond what a
// real page would carry: no shell stylesheet, no reset, no inline styling of the subject. What goes
// in is exactly the subject's own layers — document base (config-gated), the active theme, and the
// component's CSS closure. Adding anything here reopens that contract; see CONTRIBUTING.md, "The preview is an honest page".
//
// `escapeAttr` is applied at every attribute bake site — that is the sole injection defence, since
// the preview is deliberately same-origin so PD can read the rendered source back for verification.
//
// Pure composition over explicit arguments: no server state, no I/O. The stylesheet layers and the
// per-component assets (closure, scripts and their versions, SVG symbols) come from document-layers.ts.

import type { LayoutMode, ThemeSwitch } from "@pattern-dump/contracts";
import { scriptUrl } from "@pattern-dump/contracts";
import { stylesheetLayers } from "./document-layers.js";
import { escapeAttr } from "./http-utils.js";

/**
 * How wide a `centered` preview's content needs the viewport to be, measured without touching the
 * page. Plain JS, inlined into the preview's measurement script as `pdContentWidth()`.
 *
 * Walks the body. Text counts by its line boxes; a box narrower than its container (an inline-block,
 * a flex item, anything with a set width, a replaced element) counts by its own right edge. A box
 * that fills its container says nothing about the content's width, so it counts as what its content
 * needs plus its own right padding, border and margin — except a grid or table, whose columns are laid
 * out from the container's width, so it keeps its full width. The result is the rightmost of these
 * plus the body's right margin, in viewport pixels. A component the page lays out full-width (a
 * width:100% input, a progress bar) measures full-width: that is how it renders.
 */
const CONTENT_WIDTH_SCRIPT = `
function pdContentWidth(){
  function px(v){ return parseFloat(v) || 0; }
  function need(el){
    var right = 0, cr = el.getBoundingClientRect().right, es = getComputedStyle(el);
    var contentRight = cr - px(es.paddingRight) - px(es.borderRightWidth);
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        if (!/\\S/.test(c.data)) continue;
        var rg = document.createRange(); rg.selectNodeContents(c);
        var rs = rg.getClientRects();
        for (var i = 0; i < rs.length; i++) right = Math.max(right, rs[i].right);
        continue;
      }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'NOSCRIPT') continue;
      var cs = getComputedStyle(c);
      if (cs.display === 'none') continue;
      var r = c.getBoundingClientRect();
      var box = /^(IMG|SVG|VIDEO|CANVAS|IFRAME|INPUT|SELECT|TEXTAREA|OBJECT|EMBED)$/.test(tag);
      if (cs.display === 'contents' || (!box && cs.display === 'inline') || (r.width === 0 && r.height === 0)) {
        right = Math.max(right, need(c));
      } else if (!box && !/grid|table/.test(cs.display) && r.right + px(cs.marginRight) >= contentRight - 0.5) {
        var inner = Math.max(need(c), r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft));
        right = Math.max(right, inner + px(cs.paddingRight) + px(cs.borderRightWidth) + px(cs.marginRight));
      } else {
        right = Math.max(right, r.right + px(cs.marginRight));
      }
    }
    return right;
  }
  var b = document.body, bs = getComputedStyle(b);
  return Math.ceil(need(b) + px(bs.paddingRight) + px(bs.borderRightWidth) + px(bs.marginRight));
}
`;

export function buildPreviewDocument(
  html: string,
  closureIds: string[],   // component ids whose CSS files to link, in dependency order
  layout: LayoutMode,
  themeNames: string[],
  defaultTheme?: string,
  requireScripts?: string[],
  svgContents?: string[],
  assetsCss?: string[],
  componentId?: string,
  // baseHref: omit in dev (unsandboxed srcdoc inherits parent origin; root-relative URLs resolve).
  // Supply for the static build where the deployment base differs from the serving origin.
  baseHref?: string,
  scriptVersions?: Map<string, number>,
  // linkBase: inject the document-base layer (/_pd/base.css) beneath the closure. Driven by
  // config.documentBase; off preserves the honest-UA-page default for projects with no shared layer.
  linkBase = false,
  // themeSwitch: 'stylesheet' links only the active theme (bare-:root sets don't collide);
  // 'attribute' (default) links all and toggles via [data-theme].
  themeSwitch: ThemeSwitch = "attribute",
  // baseCssVersion: stamped as ?v= once the base layer has changed since boot, so a preview reloaded
  // after a base edit fetches the new sheet. 0 (never changed) keeps the bare URL.
  baseCssVersion = 0
): string {
  const componentAttr = componentId ? ` data-component-id="${escapeAttr(componentId)}"` : "";
  const bodyAttr = `${defaultTheme ? ` data-theme="${escapeAttr(defaultTheme)}"` : ""}${componentAttr}`;
  // The measurement script — the one thing PD adds to the body besides the markup, and it only READS
  // the page. The parent identifies which iframe sent a message via e.source.
  //  - pd-height (both layouts): document.documentElement.scrollHeight, the only measurement that
  //    captures glyph ink overflow beyond the line box and has margin collapse already applied.
  //  - pd-width (centered only): how wide the content needs the viewport to be, so the Stage can size
  //    the iframe to it and centre it. Nothing in the document is restyled to find out; see
  //    CONTENT_WIDTH_SCRIPT. `at` is the width it was measured at: the Stage trusts only a measurement
  //    taken at the full available width, which keeps wrapped text from narrowing the frame step by step.
  const widthPost = layout === "centered"
    ? `window.parent.postMessage({type:'pd-width',width:pdContentWidth(),at:window.innerWidth,scroll:document.documentElement.scrollWidth},'*');`
    : "";
  const resizeScript = layout === "centered" || layout === "full"
    ? `<script>(function(){${layout === "centered" ? CONTENT_WIDTH_SCRIPT : ""}var _t;new ResizeObserver(function(){clearTimeout(_t);_t=setTimeout(function(){window.parent.postMessage({type:'pd-height',height:document.documentElement.scrollHeight},'*');${widthPost}},50);}).observe(document.body);})();</script>`
    : "";

  const baseTag = baseHref ? `<base href="${escapeAttr(baseHref)}">` : "";

  // Layers 0–3, shared with every document PD assembles (document-layers.ts).
  const layers = stylesheetLayers({
    closureIds, themeNames, defaultTheme, assetsCss, linkBase, themeSwitch, baseCssVersion,
  });

  // SVG symbol sets inlined hidden at top of body.
  const symbolSets = (svgContents ?? []).join("\n");

  // requireScript tags (module, in declaration order).
  // Local ids are stamped with ?v=<mtime> so the browser fetches fresh JS after a file change.
  const scriptTags = (requireScripts ?? [])
    .map(src => {
      if (src.includes("://")) return `<script type="module" src="${escapeAttr(src)}"></script>`;
      const v = scriptVersions?.get(src);
      return `<script type="module" src="${escapeAttr(scriptUrl(src, v ?? undefined))}"></script>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${baseTag}${layers.base}
${layers.assets}
${layers.themes}
${layers.closure}
</head>
<body${bodyAttr}>
${symbolSets}
${html}
${resizeScript}
${scriptTags}
</body>
</html>`;
}

/**
 * Rewrite asset references to the `/assets/<root>/…` served path. Applied to rendered markup and to
 * the compiled CSS PD serves (base, component and theme stylesheets), so `url()` works too.
 *
 * Two forms, both keyed on an asset root's BASENAME (e.g. `images`, `fonts`):
 *  - relative: `../../images/x` and `../images/x` both become `/assets/images/x`. Deliberately
 *    depth-independent: hTWOo's `<use href="../../images/icons.svg#…">` is frozen and cannot be
 *    codemodded, and a scheme that made `../../` resolve breaks when a pattern's nesting changes.
 *  - root-absolute: `/images/x`, the form PatternLab projects use, becomes `/assets/images/x`. Only at
 *    the start of a URL (after a quote, `(`, `=`, `,` or whitespace), so other hosts' paths and
 *    already-served `/assets/…` paths are left alone.
 */
export function normalizeAssetRefs(text: string, rootNames: string[]): string {
  if (rootNames.length === 0) return text;
  const alt = (names: string[]) => names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // one or more ./ or ../ segments, then a known asset-root basename, then /
  let out = text.replace(new RegExp(`(?:\\.\\.?/)+(${alt(rootNames)})/`, "g"), "/assets/$1/");
  // A root named `assets` is already the served prefix: /assets/… needs no rewrite.
  const absNames = rootNames.filter(n => n !== "assets");
  if (absNames.length > 0) {
    out = out.replace(new RegExp(`(^|["'(=,\\s])/(${alt(absNames)})/`, "g"), "$1/assets/$2/");
  }
  return out;
}
