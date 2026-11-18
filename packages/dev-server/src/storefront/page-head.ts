// The stylesheet links and behaviour scripts of a storefront page: the same layers as every document PD assembles
// (document-layers.ts) — the document base, project asset CSS and the layout's CSS closure — with no
// theme layer: preview themes theme the component under test, inside its preview, never a page. The scripts are
// those a preview of the same components loads: the project's globalScripts, then every requireScript of the
// layout's composition and of each component the page places (pd- tags), in that order, each once.
// Nothing here works out a closure or writes a link itself.

import { scriptUrl, type DiscoveryResult } from "@pattern-dump/contracts";
import { borrowedStyleMessage, borrowedStyles } from "../css-closure.js";
import { includeClosure } from "../diagnostics.js";
import { resolveDocumentAssets, stylesheetLayers } from "../document-layers.js";
import { designFiles } from "./design-files.js";
import { escapeAttr } from "../http-utils.js";
import { aggregateRequires, findSvgSets, type SvgSet } from "../requires.js";
import type { ResolvedConfig } from "../server-config.js";
import { compositionFor, type ServerState } from "../server-state.js";

export async function pageStylesheets(
  cfg: ResolvedConfig, state: ServerState, discovery: DiscoveryResult, layoutId: string, html: string, placed: readonly string[] = [],
): Promise<string> {
  // The request's own discovery, taken once by the route: the state's may have been invalidated since.
  const { discoveryMap, handleMap } = discovery;
  const requireScripts: string[] = [];
  for (const id of [layoutId, ...placed]) {
    for (const s of (await aggregateRequires(id, cfg.patternDirs, handleMap, discoveryMap)).scripts) {
      if (!requireScripts.includes(s)) requireScripts.push(s);
    }
  }
  const assets = await resolveDocumentAssets(cfg, state, {
    componentId: layoutId, html, requireScripts, requireAssets: undefined,
    compositionRegistry: await compositionFor(state, discovery, cfg.patternDirs), discoveryMap,
  });
  const layers = stylesheetLayers({
    closureIds: assets.closureIds, themeNames: [], assetsCss: cfg.assetsCss,
    linkBase: cfg.documentBaseEnabled, themeSwitch: cfg.themeSwitch, baseCssVersion: state.baseCssVersion,
  });
  const scripts = assets.scripts.map(src => src.includes("://")
    ? `<script type="module" src="${escapeAttr(src)}"></script>`
    : `<script type="module" src="${escapeAttr(scriptUrl(src, assets.scriptVersions?.get(src) ?? undefined))}"></script>`);
  return [layers.base, layers.assets, layers.themes, layers.closure, ...scripts].filter(Boolean).join("\n");
}

/** The symbol sets a page needs, and each set no asset folder has, with the component that needs it. */
export interface PageSymbolSets { sets: SvgSet[]; missing: Array<{ component: string; id: string }> }

/**
 * The symbol sets (`requireAssets`) the components a page renders need, as a preview of each would load them: for its
 * layout and each component it renders besides (`roots`), the sets of it and of everything it includes, each set once,
 * in the order first needed. Looked up in every asset folder (findSvgSets).
 */
export async function pageSymbolSets(cfg: ResolvedConfig, discovery: DiscoveryResult, roots: readonly string[]): Promise<PageSymbolSets> {
  const { discoveryMap, handleMap } = discovery;
  const firstNeed = new Map<string, string>();
  for (const id of roots) {
    for (const set of (await aggregateRequires(id, cfg.patternDirs, handleMap, discoveryMap)).assets) {
      if (!firstNeed.has(set)) firstNeed.set(set, id);
    }
  }
  const { sets, missing } = await findSvgSets([...firstNeed.keys()], cfg.assetRoots);
  return { sets, missing: missing.map(id => ({ component: firstNeed.get(id)!, id })) };
}

/**
 * The stylesheets a page links only because a template in it borrows a class (css-closure.ts, borrowedStyles): for
 * every component the page renders (its layout's include tree and what it places, `roots`), each owner of a class
 * it uses that nothing on the page includes. One message per (component, owner), as the component's own
 * STYLE_BORROWED says it; the page turns each into a warning. Empty without a style index.
 */
export async function pageBorrowedStyles(
  state: ServerState, discovery: DiscoveryResult, patternDirs: ResolvedConfig["patternDirs"], roots: readonly string[],
): Promise<string[]> {
  const owners = state.classOwnerIndex;
  if (!owners) return [];
  const composition = await compositionFor(state, discovery, patternDirs);
  const included = new Set(roots.flatMap(r => includeClosure(r, composition)));
  const files = designFiles(discovery.discoveryMap);
  const messages: string[] = [];
  for (const id of [...included].sort()) {
    const hbsPath = discovery.discoveryMap.get(id)?.hbsPath;
    const hbs = hbsPath ? await files.text(hbsPath).catch(() => "") : "";
    for (const b of borrowedStyles(hbs, id.split("~")[0]!, owners, included)) messages.push(borrowedStyleMessage(id, b));
  }
  return messages;
}
