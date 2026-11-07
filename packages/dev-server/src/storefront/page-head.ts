// The stylesheet links of a storefront page: the same layers as every document PD assembles
// (document-layers.ts) — the document base, project asset CSS and the layout's CSS closure — with no
// theme layer: preview themes theme the component under test, inside its preview, never a page.
// Nothing here works out a closure or writes a link itself.

import type { DiscoveryMap } from "@pattern-dump/contracts";
import { buildCompositionRegistry } from "../composition.js";
import { resolveDocumentAssets, stylesheetLayers } from "../document-layers.js";
import type { ResolvedConfig } from "../server-config.js";
import type { ServerState } from "../server-state.js";

export async function pageStylesheets(
  cfg: ResolvedConfig, state: ServerState, discoveryMap: DiscoveryMap, layoutId: string, html: string,
): Promise<string> {
  if (!state.compositionRegistry) {
    state.compositionRegistry = await buildCompositionRegistry(cfg.patternDirs, state.discoveryResult!.handleMap, discoveryMap);
  }
  const assets = await resolveDocumentAssets(cfg, state, {
    componentId: layoutId, html, requireScripts: undefined, requireAssets: undefined,
    compositionRegistry: state.compositionRegistry, discoveryMap,
  });
  const layers = stylesheetLayers({
    closureIds: assets.closureIds, themeNames: [], assetsCss: cfg.assetsCss,
    linkBase: cfg.documentBaseEnabled, themeSwitch: cfg.themeSwitch, baseCssVersion: state.baseCssVersion,
  });
  return [layers.base, layers.assets, layers.themes, layers.closure].filter(Boolean).join("\n");
}
