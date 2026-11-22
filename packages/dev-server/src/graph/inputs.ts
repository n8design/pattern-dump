// What the graph is built from (build.ts), gathered from what a caller already has: discovery, the include graph and
// the style data it built, and the site's page model when there is a site. The reading done here is only what none
// of those holds: the templates' text (through the design-files cache), each page's body for what it places, the
// assets.css files, and each component's own requires. Shared by pd dev, pd build, pd audit and pd graph.

import { readFile } from "node:fs/promises";
import type { DiscoveryMap, DiscoveryResult, HandleMap } from "@pattern-dump/contracts";
import type { CompositionRegistry } from "../composition.js";
import { createMarkdown } from "../code-blocks.js";
import { designFiles } from "../storefront/design-files.js";
import { frontmatterBody } from "../frontmatter.js";
import { readAssetStylesheets } from "../plain-stylesheets.js";
import { usePlacedTags, type PlacedTag, type PlacedBlock } from "../placed-tags.js";
import { normalizeScriptId, requiresList } from "../requires.js";
import { cardOf } from "../storefront/cards.js";
import { checkPageDeclaration } from "../storefront/derived.js";
import { layoutIndex } from "../storefront/layout-index.js";
import type { PageModel } from "../storefront/pages.js";
import { readSchema } from "../storefront/declared-values.js";
import { DEFAULT_VIEW_KEY, resolveView } from "../storefront/views.js";
import type { AllStyleData } from "../style-index.js";
import type { GraphInputs, GraphPageInput } from "./build.js";

export interface GraphSources {
  discovery: DiscoveryResult;
  composition: CompositionRegistry;
  style: AllStyleData;
  /** The site's page model, or null for a project without a site. */
  pages: PageModel | null;
  /** The project's `assets.css` entries, and the asset folders they are looked up in (and their names). */
  assetsCss: readonly string[];
  assetRoots: readonly string[];
  assetRootNames: readonly string[];
  display: (absPath: string) => string;
}

/** One markdown-it for reading what a body places: the placed-tag rule on, nothing rendered. */
const placementMd = usePlacedTags(createMarkdown({ html: false, linkify: false }));

/** The components a page body places: every `pd-` tag (a child tag too), by its handle, and every `pattern` fence. */
export function bodyPlacements(body: string, handleMap: HandleMap): Array<{ id: string; how: "tag" | "pattern" }> {
  const out: Array<{ id: string; how: "tag" | "pattern" }> = [];
  const visit = (tag: PlacedTag): void => {
    const id = handleMap.get(tag.name.slice("pd-".length));
    if (id) out.push({ id, how: "tag" });
    for (const child of tag.children) visit(child);
  };
  for (const tok of placementMd.parse(body, {})) {
    if (tok.type === "pd_component") {
      const root = (tok.meta as PlacedBlock).root;
      if (root) visit(root);
    } else if (tok.type === "fence") {
      const info = tok.info.trim();
      if (info !== "pattern" && !info.startsWith("pattern ")) continue;
      const spec = info.startsWith("pattern ") ? info.slice("pattern ".length).trim() : tok.content.split("\n")[0]?.trim() ?? "";
      if (spec) out.push({ id: spec, how: "pattern" });
    }
  }
  return out;
}

/** The site's pages for the graph: each with its layout and what it places. A page that can't be read places nothing. */
async function graphPages(model: PageModel, discoveryMap: DiscoveryMap, handleMap: HandleMap): Promise<GraphPageInput[]> {
  const layouts = await layoutIndex(discoveryMap);
  const files = designFiles(discoveryMap);
  const out: GraphPageInput[] = [];
  for (const p of model.pages) {
    const layoutId = p.layout !== undefined ? layouts.idOf(p.layout) : undefined;
    const generated = model.generated.get(p.route);
    if (generated) {
      out.push({
        route: p.route, generated: generated.role === "index" ? (generated.kind === "tag" ? "tags" : "categories") : generated.kind,
        ...(layoutId ? { layout: { id: layoutId, source: "generated" as const } } : {}), places: [],
      });
      continue;
    }
    const f = model.files.get(p.route);
    if (!f) continue;
    const source = p.layoutFrom !== undefined ? "folder" : f.frontmatter.values["layout"] !== undefined ? "own" : "default";
    let places: GraphPageInput["places"] = [];
    try { places = bodyPlacements(frontmatterBody(await readFile(f.file, "utf8")), handleMap); } catch { /* unreadable: its own check says so */ }
    // Its listing's view and the view's card: the one it names, else its layout's default, when the layout shows one.
    // A collection query's cards (query.ts) are not read here yet.
    if (layoutId) {
      const schema = (await readSchema(discoveryMap.get(layoutId)?.schemaPath, files)).schema;
      const shows = checkPageDeclaration(schema, layoutId).declared?.includes("listing") ?? false;
      const named = f.frontmatter.values["view"];
      const listing = (schema as { properties?: { page?: { properties?: { listing?: Record<string, unknown> } } } } | undefined)
        ?.properties?.page?.properties?.listing;
      const fallback = typeof listing?.[DEFAULT_VIEW_KEY] === "string" ? listing[DEFAULT_VIEW_KEY] as string : undefined;
      const { view } = await resolveView({
        view: typeof named === "string" ? named : undefined, line: undefined, path: f.path, layout: p.layout!, layoutId,
        shows, discoveryMap, fallback,
      });
      if (view) places = [...places, { id: view.id, how: "view" }, { id: view.card.id, how: "card" }];
      // A layout that lists the folder's pages itself, each as its card (x-pd-card on page.children).
      const layoutCard = cardOf((schema as { properties?: { page?: { properties?: { children?: unknown } } } } | undefined)
        ?.properties?.page?.properties?.children);
      if (layoutCard) places = [...places, { id: layoutCard, how: "card" }];
    }
    out.push({
      route: p.route, file: f.path,
      ...(layoutId ? { layout: { id: layoutId, source, ...(p.layoutFrom !== undefined ? { via: p.layoutFrom } : {}) } } : {}),
      places,
    });
  }
  return out;
}

export async function gatherGraphInputs(s: GraphSources): Promise<GraphInputs> {
  const { discoveryMap, handleMap } = s.discovery;
  const files = designFiles(discoveryMap);
  const templates = new Map<string, string>();
  const requires = new Map<string, { scripts: string[]; assets: string[] }>();
  for (const [id, entry] of discoveryMap) {
    // A data variant renders its base's template (discovery gives it the base's path), so its classes are those.
    if (entry.hbsPath) {
      try { templates.set(id, await files.text(entry.hbsPath)); } catch { /* unreadable: its render says so */ }
    }
    if (entry.mdPath && !id.includes("~")) {
      try {
        const md = await readFile(entry.mdPath, "utf8");
        const scripts = requiresList(md, "requireScript").map(normalizeScriptId);
        const assets = requiresList(md, "requireAssets");
        if (scripts.length || assets.length) requires.set(id, { scripts, assets });
      } catch { /* no docs */ }
    }
  }
  const layouts = await layoutIndex(discoveryMap);
  return {
    discovery: s.discovery,
    composition: s.composition,
    style: s.style,
    layouts: new Set(layouts.entries().map(e => e.id)),
    templates,
    assetSheets: await readAssetStylesheets(s.assetsCss, s.assetRoots, s.assetRootNames, f => readFile(f, "utf8")),
    pages: s.pages ? await graphPages(s.pages, discoveryMap, handleMap) : [],
    requires,
    display: s.display,
  };
}
