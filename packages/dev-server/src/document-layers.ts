// The layers a document is built from, shared by every document PD assembles.
//
// Two halves:
//   - stylesheetLayers(): layers 0–3 of a document's <head> — the document base, project asset CSS, the
//     theme set, and the component CSS closure — as link markup, in the order they must appear. The
//     preview document writes them in that order; any other document that shows components uses the
//     same layers rather than a copy.
//   - resolveDocumentAssets(): what a component's document needs, worked out from the server state: its
//     linkable CSS closure (the static closure plus the owners of classes the render actually used), its
//     behaviour scripts (the project's global ones first) and their versions, and its SVG symbol sets.
//
// `escapeAttr` is applied at every attribute bake site, as in the preview document: it is the injection
// defence for anything PD writes into a document.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { componentCssUrl, PD_ROUTES, themeCssUrl, type DiscoveryMap, type ThemeSwitch } from "@pattern-dump/contracts";
import type { CompositionRegistry } from "./composition.js";
import { computeCssClosure, linkableClosure, withRenderedClassOwners } from "./css-closure.js";
import { escapeAttr } from "./http-utils.js";
import { loadSvgAssets } from "./requires.js";
import type { ResolvedConfig } from "./server-config.js";
import type { ServerState } from "./server-state.js";

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

/** What layers 0–3 are built from. */
export interface StylesheetLayerInput {
  /** Component ids whose CSS files to link, in dependency order (already filtered to the linkable ones). */
  closureIds: string[];
  themeNames: string[];
  defaultTheme?: string;
  assetsCss?: string[];
  /** Link the document-base layer (/_pd/base.css). Driven by config.documentBase. */
  linkBase: boolean;
  themeSwitch: ThemeSwitch;
  /** Stamped as ?v= once the base layer has changed since boot. 0 keeps the bare URL. */
  baseCssVersion: number;
}

/** Layers 0–3 as link markup, one string per layer (empty when the layer has nothing). */
export interface StylesheetLayers {
  base: string;
  assets: string;
  themes: string;
  closure: string;
}

export function stylesheetLayers(input: StylesheetLayerInput): StylesheetLayers {
  const { closureIds, themeNames, defaultTheme, assetsCss, linkBase, themeSwitch, baseCssVersion } = input;

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

  return { base: baseLink, assets: assetCssLinks, themes: themeLinks, closure: closureLinks };
}

/** What a component's document needs besides its markup. */
export interface DocumentAssets {
  /** Linkable CSS closure: component ids, deps before dependents, only those with compiled CSS. */
  closureIds: string[];
  /** Behaviour scripts: the project's global scripts, then the component's own. */
  scripts: string[];
  /** Script versions (?v=), when there are scripts and a scripts folder. */
  scriptVersions: Map<string, number> | undefined;
  /** SVG symbol sets to inline. */
  svgContents: string[];
}

export interface DocumentAssetsInput {
  componentId: string;
  /** The rendered markup: classes it uses pull in their owners' CSS. */
  html: string;
  requireScripts: string[] | undefined;
  requireAssets: string[] | undefined;
  compositionRegistry: CompositionRegistry;
  discoveryMap: DiscoveryMap;
}

export async function resolveDocumentAssets(
  cfg: ResolvedConfig,
  state: ServerState,
  input: DocumentAssetsInput,
): Promise<DocumentAssets> {
  const { componentId, html, requireScripts, requireAssets, compositionRegistry, discoveryMap } = input;
  const classOwners = state.classOwnerIndex ?? new Map();
  const svgContents = requireAssets && cfg.assetsDir
    ? await loadSvgAssets(requireAssets, cfg.assetsDir)
    : [];
  const closureIds = withRenderedClassOwners(await computeCssClosure(
    componentId, compositionRegistry, cfg.patternDirs, classOwners, discoveryMap
  ), html, classOwners);
  const scripts = cfg.withGlobalScripts(requireScripts);
  const scriptVersions = cfg.scriptsDirs.length && scripts.length
    ? await buildScriptVersions(scripts, cfg.scriptsDirs)
    : undefined;
  return { closureIds: linkableClosure(closureIds, state.perComponentCss), scripts, scriptVersions, svgContents };
}
