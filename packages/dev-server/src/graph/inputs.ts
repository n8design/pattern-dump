// What the graph is built from (build.ts), gathered from what a caller already has: discovery, the include graph and
// the style data it built, and the site's page model when there is a site. The reading done here is only what none
// of those holds: the templates' text (through the design-files cache), each page's body for what it places, the
// assets.css files, and each component's own requires. Shared by pd dev, pd build, pd audit and pd graph.

import { readFile } from "node:fs/promises";
import type { DiscoveryMap, DiscoveryResult, HandleMap } from "@pattern-dump/contracts";
import type { CompositionRegistry } from "../composition.js";
import { createMarkdown } from "../code-blocks.js";
import { designFiles } from "../storefront/design-files.js";
import { frontmatterBody, type FrontmatterReading } from "../frontmatter.js";
import { readAssetStylesheets } from "../plain-stylesheets.js";
import { usePlacedTags, type PlacedTag, type PlacedBlock } from "../placed-tags.js";
import { normalizeScriptId, requiresList } from "../requires.js";
import { cardOf } from "../storefront/cards.js";
import { checkPageDeclaration } from "../storefront/derived.js";
import { layoutIndex } from "../storefront/layout-index.js";
import type { PageModel } from "../storefront/pages.js";
import { readSchema } from "../storefront/declared-values.js";
import { declaredQueries, type DeclaredQuery } from "../storefront/query.js";
import { DEFAULT_VIEW_KEY, resolveView, viewOf, type ResolvedView } from "../storefront/views.js";
import type { AllStyleData } from "../style-index.js";
import type { GraphInputs, GraphPageInput } from "./build.js";
import { verboseTiming } from "../timing.js";

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

/** What a page body names, as written: each `pd-` tag's handle (a child tag's too) and each `pattern` fence's id. */
type Named = ReadonlyArray<{ name: string; how: "tag" | "pattern" }>;

/** What a page body names, by its text: every rebuild of the graph (any save) reads every page, and parsing the
 *  markdown again was most of the rebuild (70 ms of 75 at 500 pages). Kept for up to 10,000 bodies, then started
 *  again; an edited page is a new text. Handles are resolved after, so a new discovery keeps what is kept. */
const keptNames = new Map<string, Named>();
function namedIn(body: string): Named {
  let named = keptNames.get(body);
  if (!named) {
    if (keptNames.size >= 10_000) keptNames.clear();
    const out: Array<{ name: string; how: "tag" | "pattern" }> = [];
    const visit = (tag: PlacedTag): void => {
      out.push({ name: tag.name.slice("pd-".length), how: "tag" });
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
        if (spec) out.push({ name: spec, how: "pattern" });
      }
    }
    named = Object.freeze(out);
    keptNames.set(body, named);
  }
  return named;
}

/** The components a page body places: every `pd-` tag (a child tag too), by its handle, and every `pattern` fence. */
export function bodyPlacements(body: string, handleMap: HandleMap): Array<{ id: string; how: "tag" | "pattern" }> {
  return namedIn(body).flatMap(({ name, how }) => {
    const id = how === "tag" ? handleMap.get(name) : name;
    return id ? [{ id, how }] : [];
  });
}

/** Each page's body, by route, kept with the page model it was read for: a save that changes no page (a stylesheet's,
 *  a template's) keeps the model, and the graph is built again without reading 500 pages. Read all at once: one after
 *  another, the reads were most of what was left of a rebuild. Null for a page that can't be read. */
const keptBodies = new WeakMap<PageModel, Promise<Map<string, string | null>>>();
function bodiesOf(model: PageModel): Promise<Map<string, string | null>> {
  let bodies = keptBodies.get(model);
  if (!bodies) {
    bodies = Promise.all([...model.files.values()].map(async f =>
      [f.route, await readFile(f.file, "utf8").then(frontmatterBody, () => null)] as const)).then(entries => new Map(entries));
    keptBodies.set(model, bodies);
  }
  return bodies;
}

/** The site's pages for the graph: each with its layout and what it places. A page that can't be read places nothing. */
async function graphPages(model: PageModel, discoveryMap: DiscoveryMap, handleMap: HandleMap): Promise<GraphPageInput[]> {
  const layouts = await layoutIndex(discoveryMap);
  const files = designFiles(discoveryMap);
  // What a page's lists take from its layout, read once per layout: whether it shows a listing, its default view, its
  // own card (x-pd-card on page.children: a layout that lists the folder's pages itself), and its queries (query.ts:
  // related pages, a home page's latest), each with its card and default view. And each view a layout and a page's
  // `view:` resolve to, once per pair.
  type LayoutFacts = { shows: boolean; fallback: string | undefined; layoutCard: string | undefined; queries: DeclaredQuery[] };
  const byLayout = new Map<string, Promise<LayoutFacts>>();
  const facts = (layoutId: string): Promise<LayoutFacts> => {
    let found = byLayout.get(layoutId);
    if (!found) {
      found = readSchema(discoveryMap.get(layoutId)?.schemaPath, files).then(({ schema }) => {
        const page = (schema as { properties?: { page?: { properties?: { listing?: Record<string, unknown>; children?: unknown } } } } | undefined)
          ?.properties?.page?.properties;
        const fallback = page?.listing?.[DEFAULT_VIEW_KEY];
        return {
          shows: checkPageDeclaration(schema, layoutId).declared?.includes("listing") ?? false,
          fallback: typeof fallback === "string" ? fallback : undefined,
          layoutCard: cardOf(page?.children),
          queries: declaredQueries(schema),
        };
      });
      byLayout.set(layoutId, found);
    }
    return found;
  };
  const views = new Map<string, ResolvedView | undefined>();
  const viewNamed = async (name: string): Promise<ResolvedView | undefined> => {
    const key = `\u0001${name}`;
    if (!views.has(key)) views.set(key, (await viewOf(name, name, discoveryMap)).view);
    return views.get(key);
  };
  /** What a layout's queries place on a page: the queries the page (its frontmatter, none for a generated page) doesn't
   *  turn off, each with its card, and its view (the page's, else the layout's default) with the view's card. */
  const queryPlaces = async (queries: DeclaredQuery[], fm?: FrontmatterReading): Promise<GraphPageInput["places"]> => {
    const out: GraphPageInput["places"] = [];
    for (const q of queries) {
      if (fm?.values[q.name] === "false") continue;
      if (q.card) out.push({ id: q.card, how: "card" });
      const own = fm?.maps[q.name]?.["view"];
      const name = typeof own === "string" ? own : typeof q.defaults["view"] === "string" ? q.defaults["view"] : undefined;
      const view = name ? await viewNamed(name) : undefined;
      if (view) out.push({ id: view.id, how: "view" }, { id: view.card.id, how: "card" });
    }
    return out;
  };
  const bodies = await bodiesOf(model);
  const out: GraphPageInput[] = [];
  for (const p of model.pages) {
    const layoutId = p.layout !== undefined ? layouts.idOf(p.layout) : undefined;
    const generated = model.generated.get(p.route);
    if (generated) {
      out.push({
        route: p.route, generated: generated.role === "index" ? (generated.kind === "tag" ? "tags" : "categories") : generated.kind,
        ...(generated.term ? { term: generated.term.key } : {}),
        ...(layoutId ? { layout: { id: layoutId, source: "generated" as const } } : {}),
        // A generated page lists its term's pages through its layout's queries, with their defaults.
        places: layoutId ? await queryPlaces((await facts(layoutId)).queries) : [],
      });
      continue;
    }
    const f = model.files.get(p.route);
    if (!f) continue;
    const source = p.layoutFrom !== undefined ? "folder" : f.frontmatter.values["layout"] !== undefined ? "own" : "default";
    let places: GraphPageInput["places"] = [];
    // A page that can't be read places nothing: its own check says so.
    const body = bodies.get(p.route);
    if (body) places = bodyPlacements(body, handleMap);
    // Its listing's view and the view's card: the one it names, else its layout's default, when the layout shows one.
    // Then each of its layout's queries the page doesn't turn off: the query's card, and its view (the page's, else
    // the layout's default) with the view's card. A query that matches no page still places them: the graph says what
    // the page is built from, not what one build listed.
    if (layoutId) {
      const { shows, fallback, layoutCard, queries } = await facts(layoutId);
      const named = f.frontmatter.values["view"];
      const viewName = typeof named === "string" ? named : undefined;
      const viewKey = `${layoutId}\u0000${viewName ?? ""}`;
      let view = views.get(viewKey);
      if (!views.has(viewKey)) {
        ({ view } = await resolveView({ view: viewName, line: undefined, path: f.path, layout: p.layout!, layoutId, shows, discoveryMap, fallback }));
        views.set(viewKey, view);
      }
      if (view) places = [...places, { id: view.id, how: "view" }, { id: view.card.id, how: "card" }];
      if (layoutCard) places = [...places, { id: layoutCard, how: "card" }];
      places = [...places, ...await queryPlaces(queries, f.frontmatter)];
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
  if (verboseTiming) console.time("[dev-server:timing] graph inputs: templates and requires");
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
  if (verboseTiming) console.timeEnd("[dev-server:timing] graph inputs: templates and requires");
  const layouts = await layoutIndex(discoveryMap);
  if (verboseTiming) console.time("[dev-server:timing] graph inputs: pages");
  const pages = s.pages ? await graphPages(s.pages, discoveryMap, handleMap) : [];
  if (verboseTiming) console.timeEnd("[dev-server:timing] graph inputs: pages");
  return {
    discovery: s.discovery,
    composition: s.composition,
    style: s.style,
    layouts: new Set(layouts.entries().map(e => e.id)),
    templates,
    assetSheets: await readAssetStylesheets(s.assetsCss, s.assetRoots, s.assetRootNames, f => readFile(f, "utf8")),
    pages,
    requires,
    display: s.display,
  };
}
