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
// Pure composition over explicit arguments: no server state, no I/O except stat-ing script mtimes.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { LayoutMode, ThemeSwitch } from "@pattern-dump/contracts";
import { componentCssUrl, PD_ROUTES, scriptUrl, themeCssUrl } from "@pattern-dump/contracts";
import { escapeAttr } from "./http-utils.js";

// Stat each script's .ts source to get its current mtime (milliseconds since epoch).
// Called just before buildPreviewDocument so the version is fresh on every render.
// Unknown ids are silently skipped (no .ts file → no ?v= stamp, browser cache used).
export async function buildScriptVersions(
  ids: string[],
  dirs: string | string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  await Promise.all(ids.map(async id => {
    // First folder that has the script, in the same order the script route resolves it.
    for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
      try {
        const { mtimeMs } = await stat(join(dir, `${id}.ts`));
        map.set(id, mtimeMs);
        return;
      } catch { /* not in this folder */ }
    }
  }));
  return map;
}

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
  const bodyAttr   = defaultTheme ? ` data-theme="${escapeAttr(defaultTheme)}"` : "";
  const layoutClass = layout === "full" ? "layout-full" : "layout-centered";
  // Drop src:location.pathname — pathname is meaningless under srcdoc.
  // The parent identifies which iframe sent the message via e.source.
  // pd-width: centered layout only (full-layout fixtures are width-inert).
  // pd-height: both layouts use document.documentElement.scrollHeight — the only measurement
  //   that captures glyph ink overflow beyond the CSS line-box. main.scrollHeight only sees
  //   the line-box; decorative/cursive fonts with tall ascenders or descenders report a lower
  //   value, causing the frame to be set too short and the content to be clipped.
  //   documentElement.scrollHeight also handles CSS margin-collapse correctly: when a child's
  //   margin-top is larger than the body's (e.g. a <p> at 2rem → 32 px collapses with body's
  //   8 px), the collapsed margin is already baked in — no manual margin arithmetic needed.
  //   For normal fonts both values are numerically identical (zero regression).
  // pd-width still uses main.scrollWidth + body horizontal margins: glyph overflow is vertical
  //   only, and document.documentElement.scrollWidth can be unreliable for centered layouts.
  const widthPost = layout === "centered"
    ? `window.parent.postMessage({type:'pd-width',width:(function(){var m=document.querySelector('main')||document.body,cs=getComputedStyle(document.body);return Math.ceil(m.scrollWidth+(parseFloat(cs.marginLeft)||0)+(parseFloat(cs.marginRight)||0));}())},'*');`
    : "";
  const heightMeasure = `document.documentElement.scrollHeight`;
  const resizeScript = layout === "centered" || layout === "full"
    ? `<script>(function(){var _t;new ResizeObserver(function(){clearTimeout(_t);_t=setTimeout(function(){window.parent.postMessage({type:'pd-height',height:${heightMeasure}},'*');${widthPost}},50);}).observe(document.body);})();</script>`
    : "";

  const baseTag = baseHref ? `<base href="${escapeAttr(baseHref)}">` : "";

  // Layer 0: document-base — the shared, origin-unattributed layer (resets, :root, @font-face,
  // family-level classes with no single owning component). Linked FIRST so the component closure
  // (Layer 3) overrides it. Opt-in via config.documentBase (M5-CSS-EXTERNAL §2.2: closure + base +
  // active theme). The shell injects nothing — this link is part of the server-built document.
  const baseHrefV = baseCssVersion > 0 ? `${PD_ROUTES.baseCss}?v=${baseCssVersion}` : PD_ROUTES.baseCss;
  const baseLink = linkBase ? `<link rel="stylesheet" href="${escapeAttr(baseHrefV)}">` : "";

  // Layer 1a: project asset CSS (htwoo.min.css, htwoo-themes.css, etc.) — linked before component CSS.
  // A full URL (a web-font stylesheet, a CDN) is linked as it is, the same rule as globalScripts;
  // anything else is a path in the assets folder.
  const assetCssLinks = (assetsCss ?? [])
    .map(p => `<link rel="stylesheet" href="${escapeAttr(p.includes("://") ? p : `/assets/${p}`)}">`)
    .join("\n");

  // Layer 2: theme sets.
  //  - 'attribute' (default): link ALL themes; the CSS uses [data-theme=] selectors, toggled on body.
  //  - 'stylesheet': link ONLY the active theme, anchored by data-pd-theme; the client swaps its href
  //    on change. Correct for bare-`:root` theme sets (hTWOo) that would collide if all were linked.
  const themeLinks = themeSwitch === "stylesheet"
    ? (defaultTheme
        ? `<link rel="stylesheet" href="${escapeAttr(themeCssUrl(defaultTheme))}" data-pd-theme="${escapeAttr(defaultTheme)}">`
        : "")
    : themeNames
        .map(n => `<link rel="stylesheet" href="${escapeAttr(themeCssUrl(n))}">`)
        .join("\n");

  // Layer 3: per-component own-origin CSS, in dependency order (deps before dependents).
  // data-pd-comp attribute is the HMR anchor — css-link-swap targets by this value.
  // Component ids use "/" as separators — do not encodeURIComponent (that would encode "/" to %2F).
  const closureLinks = closureIds
    .map(id => `<link rel="stylesheet" href="${escapeAttr(componentCssUrl(id))}" data-pd-comp="${escapeAttr(id)}">`)
    .join("\n");

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

  const componentAttr = componentId ? ` data-component-id="${escapeAttr(componentId)}"` : "";
  const layoutStyle = layout === "full"
    ? ' style="width:100%;max-width:none"'
    : ' style="max-width:max-content;margin-inline:auto"';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${baseTag}${baseLink}
${assetCssLinks}
${themeLinks}
${closureLinks}
</head>
<body${bodyAttr}>
${symbolSets}
<main class="${layoutClass}"${layoutStyle}${componentAttr}>${html}</main>
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
