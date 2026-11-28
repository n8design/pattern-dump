// HTTP route handling.
//
// One handler, one flat if/return chain on `pathname`, matched in order. There is no router
// abstraction and no per-route middleware — with ~18 routes, no auth and GET assumed throughout, a
// dispatch table would be indirection without payoff. The dev server is bound to 127.0.0.1 and is
// not a public surface.
//
// Everything arrives in a RouteContext instead of being captured from startDevServer's scope. That
// is the point of the split: the routes and the file watcher were inseparable only because they
// shared lexical state, so neither could move without the other.
//
// ONE WRITE TO WATCH: `/api/component/:id` sets `state.lastComponentId`. That is the
// request->watcher back-channel documented in server-state.ts — a GET leaving a breadcrumb the
// watcher later reads to decide which component a theme or script edit refreshes. It is state, not
// a cache, and it is why two concurrent clients interfere with each other.

import type { SymbolService } from "./symbol-service.js";
import { standaloneSvg } from "./symbols.js";
import { baseTokens } from "./css-tokens.js";
import { dateFormatter } from "./storefront/date-text.js";
import { atomXml, cachedFeedsOf, FEED_TYPES, feedLinksFor, rssXml } from "./storefront/feeds.js";
import type { GitDates } from "./storefront/git-dates.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, relative } from "node:path";
import { readFile } from "node:fs/promises";
import { PD_GENERATION_HEADER, PD_HOSTS, PD_PROTOCOL_HEADER, PD_PROTOCOL_VERSION, PD_ROUTE_PREFIX, PD_ROUTES, socialImageUrl, type DiscoveryMap, type DiscoveryResult, type ProjectGraphJson, type StorefrontPage } from "@pattern-dump/contracts";
import type {
  ApiError, AuditResponse, ComponentDetailResponse, ComponentTree, DiagnosticsGraph, FolderOverview, ImageLookup,
  RuleTiers, ShellClientConfig, StorefrontPagesResponse, ThemeSummary, VersionInfo,
} from "@pattern-dump/contracts";
import { getCodeCSS, getShikiCSS, highlight, wrapWithCopyButton } from "@pattern-dump/renderer";

import { sameHostWorkbenchPath } from "@pattern-dump/config";
import type { ResolvedConfig } from "./server-config.js";
import { compositionFor, currentDiscovery, type ServerState } from "./server-state.js";
import { createDisplayPath } from "./display-path.js";
import { buildGraph, graphJson, type ProjectGraph } from "./graph/build.js";
import { gatherGraphInputs, graphThemes } from "./graph/inputs.js";
import { auditStyleOf, layoutPagesOf } from "./graph/queries.js";
import { createMcpHandler, type McpHandler } from "./mcp/server.js";
import { handleMcpHttp, mcpEndpoint } from "./mcp/http.js";

/** A script with no entry point: a 404 that names where it was looked for, never stored. */
import { buildShellHtml, json, mimeType, serveFile, servesShell, workbenchTitle } from "./http-utils.js";
import { auditedComponentIds, baseComponentIds } from "./discovery-index.js";
import { buildComponentTree } from "./component-tree.js";
import { buildComponentDetail, previewTitle } from "./detail.js";
import { buildFolderOverview } from "./overview.js";
import { buildPreviewDocument, normalizeAssetRefs } from "./preview-document.js";
import { resolveDocumentAssets } from "./document-layers.js";
import { resolveLayoutMode } from "./layout-mode.js";
import { aggregateRequires, normalizeScriptId } from "./requires.js";
import { compiledScript, ScriptMissing } from "./scripts.js";
import { contentHash } from "./content-hash.js";
import { serveImageVariant } from "./image-route.js";
import { cardDirs, serveSocialImage } from "./social-route.js";
import type { DevCardRenderer } from "./social-dev.js";
import { cardFile, cardHash, type SocialCard } from "./storefront/social-images.js";
import { stampCss, stampHtml, type HashOf } from "./storefront/asset-stamps.js";
import { layoutIndex } from "./storefront/layout-index.js";
import { withBaseCss, withBaseHtml, withNoindex } from "./storefront/base-path.js";
import { buildAllStyleData } from "./style-index.js";
import {
  assembleGraph, auditInputs, auditWithHash, checkComponent, persistSlices, propertyUndeclaredDiagnostics, readDiagnosticsArtifact, refreshDiagnosticsGraph, styleBorrowedDiagnostics,
} from "./diagnostics.js";
import { testHook } from "./lazy.js";
import { verboseTiming } from "./timing.js";
import { resolveAxeCore } from "./assets.js";
import { ruleTiers } from "@pattern-dump/a11y";
import { readPages, todayOf } from "./storefront/pages.js";
import { sitePagesRead } from "./storefront/site-pages.js";
import { createPagesCache, type PagesCache } from "./storefront/pages-cache.js";
import { assetFile } from "./asset-file.js";
import { decodePath } from "./contained-file.js";
import { isOwnHost, ownHosts } from "./own-hosts.js";
import { checkPageImage } from "./storefront/page-image.js";
import { isPageImageUrl, pageImageFile } from "./storefront/page-images.js";
import { sitemapEntries, sitemapXml, storefrontRobotsTxt, workbenchRobotsTxt } from "./storefront/site-files.js";
import { assetsAt, mountedFile, mountProblems, readMounts, sitemapRoutes } from "./storefront/mounts.js";
import { claimsOf, collisionOf, describeClaim, forMounts } from "./storefront/site-output.js";
import { isFileRoute, redirectStub } from "./storefront/redirects.js";
import { assemblePage } from "./storefront/page.js";
import type { SearchRecord } from "./storefront/search.js";
import { pageBorrowedStyles, pageStylesheets, pageSymbolSets } from "./storefront/page-head.js";
import type { RenderingHandle } from "./rendering.js";
import type { SiteValuesHandle } from "./storefront/site-values.js";

/** Everything the routes need, handed in explicitly rather than captured from a closure. */
/** TEST ONLY (PD_TEST_HOOKS=1): where a test asks the watcher to settle. Not part of PD_ROUTES. */
export const TEST_SETTLE_ROUTE = "/_pd/__test/settle";

/** The storefront notes a server has printed (pd dev), so each is printed once. */
const printedNotes = new WeakMap<RouteContext, Set<string>>();

/** Per server, the storefront's page model as last read (pages-cache.ts). */
const pagesCaches = new WeakMap<RouteContext, PagesCache>();

/** The website's pages as this server serves them: pd dev shows drafts and scheduled pages; pd build leaves them out,
 *  as if their files weren't there. */
async function readStorefrontPages(ctx: RouteContext, sf: NonNullable<RouteContext["cfg"]["storefront"]>, discoveryMap?: DiscoveryMap): ReturnType<typeof readPages> {
  const { key, read } = await sitePagesRead(sf, { live: ctx.live, today: ctx.today ?? todayOf(ctx.now()), ...(discoveryMap ? { discoveryMap } : {}),
    ...(ctx.scheduled ? { scheduled: ctx.scheduled } : {}) });
  // Not read again for every request (pages-cache.ts): once in pd build, and in pd dev until the folder changes.
  let cache = pagesCaches.get(ctx);
  if (!cache) { cache = createPagesCache(sf.pagesDir, ctx.pagesOnce === true); pagesCaches.set(ctx, cache); }
  return cache.get(key, read);
}

/**
 * The project graph as it is now: built from the discovery, include graph, style data and page model, and kept until
 * one of them, or the watch generation, moves (graph/current.ts). The generation is read first, so a save that lands
 * while the inputs are gathered leaves a key the next request no longer matches. A request that has taken its
 * discovery passes it (server-state.ts, hazard 4: a request takes it once), so the graph is the one of that discovery.
 */
export async function currentGraph(ctx: RouteContext, taken?: DiscoveryResult): Promise<ProjectGraph> {
  const { cfg, state } = ctx;
  const generation = state.watchGeneration;
  const discovery = taken ?? await currentDiscovery(state, cfg.patternRoots);
  const style = await state.style.get(() => buildAllStyleData(cfg.styleRoots, baseComponentIds(discovery)));
  const composition = await compositionFor(state, discovery, cfg.patternDirs);
  const pages = cfg.storefront ? await readStorefrontPages(ctx, cfg.storefront, discovery.discoveryMap) : null;
  return state.graph.get([generation, discovery, style, composition, pages], async () => {
    const inputs = await gatherGraphInputs({
      discovery, composition, style, pages,
      assetsCss: cfg.assetsCss, assetRoots: cfg.assetRoots, assetRootNames: cfg.assetRootNames,
      display: createDisplayPath(cfg.cwd, cfg.packages),
      // The themes as compiled at boot and on each save (watch.ts): a theme save moves the watch generation.
      themes: await graphThemes(cfg, name => state.themeCss.get(name)),
    });
    if (verboseTiming) console.time("[dev-server:timing] graph build");
    const graph = buildGraph(inputs);
    if (verboseTiming) console.timeEnd("[dev-server:timing] graph build");
    return graph;
  });
}

/** Per server, the MCP server's message handler (mcp/server.ts). */
const mcpHandlers = new WeakMap<RouteContext, McpHandler>();

/**
 * The MCP server of this pd dev: tools that read the project as this server holds it. Each tool call takes the
 * discovery once and reads everything from it (server-state.ts, hazard 4). `checks` reads the audit this server has
 * run, else the one a pd audit or an earlier pd dev saved; it never starts one.
 */
export function mcpHandlerFor(ctx: RouteContext): McpHandler {
  let handler = mcpHandlers.get(ctx);
  if (handler) return handler;
  const { cfg, state } = ctx;
  const display = createDisplayPath(cfg.cwd, cfg.packages);
  const pagesPrefix = cfg.storefront ? `${relative(cfg.cwd, cfg.storefront.pagesDir).split("\\").join("/")}/` : undefined;
  handler = createMcpHandler(() => {
    let taken: Promise<DiscoveryResult> | undefined;
    const discovery = (): Promise<DiscoveryResult> => (taken ??= currentDiscovery(state, cfg.patternRoots));
    return {
      graph: async () => currentGraph(ctx, await discovery()),
      discoveryMap: async () => (await discovery()).discoveryMap,
      tree: async () => buildComponentTree(cfg.patternDirs, cfg.overviewsEnabled, (await discovery()).discoveryMap),
      audit: async () => {
        const slices = await state.audit.peek();
        if (slices) return { graph: assembleGraph([...slices.values()].map(s => s.audit)), from: "workbench" as const };
        const saved = await readDiagnosticsArtifact(cfg.cwd);
        return saved ? { graph: saved.graph, from: "last audit" as const } : null;
      },
      root: cfg.cwd, display,
      ...(pagesPrefix ? { pagesPrefix } : {}),
    };
  }, ctx.version);
  mcpHandlers.set(ctx, handler);
  return handler;
}

export interface RouteContext {
  readonly cfg: ResolvedConfig;
  /** pd dev only: renders a social image on request (social-dev.ts). */
  readonly cardRenderer?: DevCardRenderer;
  /** pd social only: scheduled pages are shown, drafts still left out (DevServerOptions.scheduled). */
  readonly scheduled?: "show";
  /** Each site page's card, by route, as its head last worked it out (social-images.ts): DevServer.socialCards. */
  readonly socialCards: Map<string, SocialCard>;
  /** Pattern Dump's version, as the MCP server names itself (DevServerOptions.version). */
  readonly version: string;
  readonly state: ServerState;
  /** The renderer and the global data it was built with: one object, taken once per request. */
  readonly rendering: RenderingHandle;
  readonly tracker: Awaited<ReturnType<typeof import("@pattern-dump/build").createSassDependencyTracker>>;
  /** Resolved in index.ts — the path literal is relative to that module's location, so it is
   *  passed in rather than recomputed here at a different depth. */
  readonly devUiDist: string;
  /** Build identity captured at BOOT — see /api/version. Must be the value from startup, not a
   *  fresh stat, or it could never detect that the running process is behind its own bundle. */
  readonly boot: BootStamp;
  /** The clock for response time stamps (the audit's `generatedAt`). See DevServerOptions.now. */
  readonly now: () => Date;
  /** The day scheduled pages are measured against (DevServerOptions.today); absent: the clock's, per request. */
  readonly today?: string;
  /** false when headless (`pd build`): there is no live-reload socket, so pages carry no client for it. */
  readonly live: boolean;
  /** Set by `pd build`: the pages folder is read once for the whole build. See DevServerOptions. */
  readonly pagesOnce?: boolean;
  /** The current live-reload generation (PD_GENERATION_HEADER); absent when headless. */
  readonly generation?: () => string;
  /** Set by `pd build`: storefront pages link into the workbench at this address, or to none (false). See
   *  DevServerOptions. */
  readonly storefrontWorkbenchUrl?: string | false;
  /** Set by `pd build`: where a storefront page's notes go. Without it they go to the terminal. */
  readonly onStorefrontNote?: (note: string) => void;
  /** Set by `pd build`: where what a storefront page gives the search index goes. */
  readonly onSearchRecord?: (record: SearchRecord) => void;
  /** The storefront pages' dates from git, when there is a storefront (git-dates.ts). */
  readonly dates?: GitDates;
  /** TEST ONLY: set when PD_TEST_HOOKS=1 on a live server; resolves once every change so far is handled. */
  readonly settle?: () => Promise<void>;
  /** storefront.site as the server holds it now (the watcher replaces it when the config changes only it). */
  readonly site: SiteValuesHandle;
  /** The image index, ready for the current generation: a storefront page's prose images are looked up in it. */
  readonly images?: () => Promise<ImageLookup>;
  /** The symbol images (symbol-service.ts): a storefront page's `#stem` images, and the standalone files. */
  readonly symbols?: SymbolService;
}

/** What the running process knows about itself, frozen at startup. The wire shape adds `protocol`. */
export type BootStamp = Readonly<Omit<VersionInfo, "protocol">>;

/** Each old route a page lists in redirectFrom, with the first page that lists it: once per page model (shared by every
 *  request until the pages change), not a search of every page on every request. */
const redirectMaps = new WeakMap<object, Map<string, StorefrontPage>>();
function redirectsOf(model: { pages: readonly StorefrontPage[] }): Map<string, StorefrontPage> {
  let map = redirectMaps.get(model);
  if (!map) {
    map = new Map();
    for (const p of model.pages) for (const from of p.redirectFrom ?? []) if (!map.has(from)) map.set(from, p);
    redirectMaps.set(model, map);
  }
  return map;
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { cfg } = ctx;
  // Only requests addressed to pd dev itself: one of its own host names at the port this request came in
  // on. A page on another site that gets a name of its own to resolve to 127.0.0.1 still sends that name.
  if (!isOwnHost(req.headers.host, ownHosts(cfg.storefront?.host, cfg.mcpHost), req.socket.localPort ?? -1)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden: this server answers only to its own host names");
    return;
  }
  // On the storefront's host, every HTML and CSS response leaves with its references to served files
  // stamped with their content hashes (storefront/asset-stamps.ts). The workbench's hosts are not stamped.
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  // The MCP server (mcp/http.ts): its own host, and /mcp on localhost and 127.0.0.1.
  const mcp = mcpEndpoint(host, new URL(req.url ?? "/", "http://x").pathname, cfg.mcpHost);
  if (mcp === "mcp") {
    return handleMcpHttp(req, res, mcpHandlerFor(ctx), { hosts: ownHosts(cfg.storefront?.host, cfg.mcpHost), port: req.socket.localPort ?? -1 });
  }
  if (mcp === "elsewhere") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`Not Found: this host is the MCP server's, at / (POST)`);
    return;
  }
  if (cfg.storefront && host === cfg.storefront.host) {
    if (!underBasePath(req, res, cfg.storefront.basePath)) return;
    // A mount's file (site.mounts) leaves as it is on disk: answered here, before the stamping and the base path
    // reach the response, so pd dev serves it byte for byte, as pd build copies it.
    if (cfg.storefront.mounts.length && await answerMount(req, res, ctx)) return;
    return stampedResponse(req, res, ctx);
  }
  return routeRequest(req, res, ctx);
}

/**
 * A site published under a path (storefront.basePath) is served under it, in pd dev as in pd build: the path is
 * taken off the request, and the storefront's routes see site paths. The host's root forwards to the path (and the
 * path without its slash to the path), so the host alone still opens the site; any other address outside the path
 * is the site's 404 page. False when the request was answered here. The test hook is the server's, not the site's.
 */
function underBasePath(req: IncomingMessage, res: ServerResponse, base: string): boolean {
  if (base === "/") return true;
  const raw = req.url ?? "/";
  const at = raw.search(/[?#]/);
  const path = at < 0 ? raw : raw.slice(0, at);
  const query = at < 0 ? "" : raw.slice(at);
  if (path === TEST_SETTLE_ROUTE) return true;
  if (path.startsWith(base)) { req.url = `/${raw.slice(base.length)}`; return true; }
  if (path === "/" || `${path}/` === base) {
    res.writeHead(302, { Location: `${base}${query}` });
    res.end();
    return false;
  }
  req.url = PD_ROUTES.notFound;
  return true;
}

/** The site's address for this request, and its feeds (feeds.ts), like the sitemap: with the site's address, for a
 *  site in search engines. In pd dev the address is the one the browser is on (under the site's path), so every link
 *  a page shows works there; in pd build it is the configured one. */
function siteFeedsOf(req: IncomingMessage, ctx: RouteContext, model: Awaited<ReturnType<typeof readStorefrontPages>>) {
  const storefront = ctx.cfg.storefront!;
  const siteUrl = storefront.url === undefined ? undefined
    : ctx.live ? `http://${req.headers.host ?? storefront.host}${storefront.basePath}` : storefront.url;
  const feedSettings = siteUrl !== undefined && storefront.index ? storefront.feeds : undefined;
  const siteFeeds = () => cachedFeedsOf(model, feedSettings!, {
    siteUrl: siteUrl!, siteTitle: typeof storefront.site?.["title"] === "string" ? storefront.site["title"] : undefined,
    lang: storefront.lang, dates: ctx.dates, mode: ctx.live ? "dev" : "build",
  });
  return { siteUrl, feedSettings, siteFeeds };
}

/** The collisions pd dev has warned about, once each per server: "<path> <what>". */
const mountWarnings = new WeakMap<RouteContext, Set<string>>();

/**
 * A request on the site's host for a mount's file (mounts.ts): the file, with its content type, read from disk on
 * every request. A folder's address without its "/" forwards to it. A file in the place of one the site writes is
 * left to the site (pd build stops on it): PD's file is served, with one warning naming both. True when answered.
 */
async function answerMount(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<boolean> {
  const sf = ctx.cfg.storefront!;
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const raw = new URL(req.url ?? "/", "http://x").pathname;
  const path = decodePath(raw);
  if (path === null) return false;
  const found = await mountedFile(sf.mounts, path);
  if (found === null) return false;
  const warnOnce = (line: string): void => {
    let seen = mountWarnings.get(ctx);
    if (!seen) mountWarnings.set(ctx, seen = new Set());
    if (seen.has(line)) return;
    seen.add(line);
    console.warn(`[dev-server] ${line}`);
  };
  if (found.kind === "folder") {
    res.writeHead(302, { Location: `${sf.basePath}${found.location.slice(1)}` });
    res.end();
    return true;
  }
  // The site's own files win in pd dev, as nothing may take their place in pd build.
  const model = await readStorefrontPages(ctx, sf, (await currentDiscovery(ctx.state, ctx.cfg.patternRoots)).discoveryMap);
  const sitePath = `${found.mount.to}${found.rel}`;
  const { feedSettings, siteFeeds } = siteFeedsOf(req, ctx, model);
  const feeds = feedSettings ? (await siteFeeds()).feeds.map(f => ({ address: f.address, source: f.feed.source })) : [];
  const assets = { roots: ctx.cfg.assetRoots, names: ctx.cfg.assetRootNames };
  const clash = collisionOf(forMounts(claimsOf(model, feeds), await assetsAt([sitePath], assets, ctx.cfg.cwd)), sitePath);
  if (clash) {
    warnOnce(`site.mounts: ${found.mount.name}/${found.rel} would be published at ${sitePath}, which is ${describeClaim(clash)}: `
      + `pd dev serves the site's, and pd build stops on it; remove the file from the mount, or publish the mount at another route`);
    return false;
  }
  for (const other of found.also) {
    warnOnce(`site.mounts: ${other} would be published at ${sitePath}, which clashes with ${found.mount.name}/${found.rel}: `
      + `pd dev serves the first mount's, and pd build stops on it; remove the file from one of the mounts`);
  }
  await serveFile(res, found.file, mimeType(extname(found.file)));
  return true;
}

/** A response held in memory: what a route wrote, to be stamped before it is sent, or hashed. */
interface HeldResponse { res: ServerResponse; status(): number; headers: Record<string, number | string | string[]>; body(): Buffer }

function holdResponse(): HeldResponse {
  let status = 200;
  const headers: Record<string, number | string | string[]> = {};
  const chunks: Buffer[] = [];
  const add = (chunk: unknown): void => { if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk as string | Uint8Array)); };
  const res = {
    setHeader(name: string, value: number | string | string[]) { headers[name.toLowerCase()] = value; return res; },
    getHeader(name: string) { return headers[name.toLowerCase()]; },
    writeHead(code: number, more?: Record<string, number | string | string[]>) {
      status = code;
      for (const [k, v] of Object.entries(more ?? {})) headers[k.toLowerCase()] = v;
      return res;
    },
    write(chunk: unknown) { add(chunk); return true; },
    end(chunk?: unknown) { add(chunk); return res; },
  };
  return { res: res as unknown as ServerResponse, status: () => status, headers, body: () => Buffer.concat(chunks) };
}

/** Per server, the stamps of the current generation: any handled change starts a new set. */
const stampCaches = new WeakMap<RouteContext, { generation: string; hashes: Map<string, Promise<string | undefined>> }>();

/** A served path's stamp: the content hash of the path as this host serves it, asked of the server itself. */
function hashOfFor(req: IncomingMessage, ctx: RouteContext): HashOf {
  const generation = ctx.generation?.() ?? "";
  let cache = stampCaches.get(ctx);
  if (!cache || cache.generation !== generation) { cache = { generation, hashes: new Map() }; stampCaches.set(ctx, cache); }
  const { hashes } = cache;
  return path => {
    let hash = hashes.get(path);
    if (!hash) {
      // Straight to the storefront's routes, past the host check: that check reads the socket the outer request
      // came in on, which is gone once its client hangs up (a page live reload replaces), and would refuse the
      // server its own request. The Host header is the outer request's, read as it arrived.
      const self = { url: path, method: "GET", headers: { host: req.headers.host } } as unknown as IncomingMessage;
      // The route first, and its references stamped only when it is a file: a missing file is the 404 page, which
      // may link that same file (a favicon not there yet), and stamping it would wait on this very lookup.
      const found = holdResponse();
      const held = holdResponse();
      const lookup = routeRequest(self, found.res, ctx).then(async () => {
        if (found.status() === 200) await sendStamped(self, found, held.res, ctx);
        const status = found.status() === 200 ? held.status() : found.status();
        if (status === 200) return contentHash(held.body());
        // Only "no such file" is remembered for the generation. Any other failure (a script that doesn't
        // compile, a file that can't be read) is reported and asked again by the next page.
        if (status !== 404) {
          if (hashes.get(path) === lookup) hashes.delete(path);
          const said = found.status() === 200 ? held.body() : found.body();
          console.error(`[site] ${path} could not be stamped: ${status} ${said.toString("utf8").split("\n")[0]!.slice(0, 160)}`);
        }
        return undefined;
      });
      hashes.set(path, lookup);
      hash = lookup;
    }
    return hash;
  };
}

async function stampedResponse(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  const held = holdResponse();
  await routeRequest(req, held.res, ctx);
  await sendStamped(req, held, res, ctx);
}

/** A held response sent on `res`, its references stamped and the base path in front of them (HTML and CSS). */
async function sendStamped(req: IncomingMessage, held: HeldResponse, res: ServerResponse, ctx: RouteContext): Promise<void> {
  const type = String(held.headers["content-type"] ?? "");
  let body: Buffer | string = held.body();
  // Stamps first, by site path; then the site's base path in front of every root-relative reference.
  const sf = ctx.cfg.storefront!;
  const base = { base: sf.basePath, workbenchPath: sameHostWorkbenchPath(sf) };
  // Under a path, a preview is kept out of search engines by its own head: no robots.txt is read there.
  const preview = sf.basePath !== "/" && (req.url ?? "").startsWith(PD_ROUTE_PREFIX.preview);
  if (/^text\/html\b/.test(type)) {
    const html = withBaseHtml(await stampHtml(body.toString("utf8"), hashOfFor(req, ctx), sf.basePath), base);
    body = preview ? withNoindex(html) : html;
  }
  else if (/^text\/css\b/.test(type)) body = withBaseCss(await stampCss(body.toString("utf8"), hashOfFor(req, ctx)), base);
  res.writeHead(held.status(), held.headers);
  res.end(body);
}

/** Every route, on every host. */
async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { cfg, state, tracker, devUiDist } = ctx;
  // One rendering for the whole request: a reload replacing it meanwhile does not mix its parts. On the storefront's
  // host everything renders with the site's image settings (RenderInput.images): its pages, the components they place,
  // and the previews and component data it serves, so the variant URLs they write are the ones its image route serves.
  const { render: renderAny, globalData } = ctx.rendering.current;
  const onSite = cfg.storefront !== null && (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase() === cfg.storefront.host;
  const render: typeof renderAny = onSite ? input => renderAny({ ...input, images: "site" }) : renderAny;
  // Destructured so the chain below reads exactly as it did inside startDevServer — this move
  // changes where the handler lives, not a line of its logic.
  const {
    patternRoots, patternDirs, styleRoots,
    themesDir, defaultTheme,
    assetRoots, assetRootNames, assetsCss,
    scriptsDirs,
    overviewsEnabled, documentBaseEnabled, themeSwitch, config, cwd, wsPort,
  } = cfg;

  // Every response — JSON, assets, previews, the shell — carries the protocol it was produced under.
  res.setHeader(PD_PROTOCOL_HEADER, String(PD_PROTOCOL_VERSION));
  // And, live, the generation it was rendered from: taken here, before anything is read, so a response
  // rendered while a change landed carries the generation from before that change, and its client fetches
  // it again once it hears of a newer one.
  const generation = ctx.generation?.();
  if (generation) res.setHeader(PD_GENERATION_HEADER, generation);

  try {
    const url      = new URL(req.url ?? "/", "http://x");
    const pathname = url.pathname;

    // TEST ONLY, not a route of the dev-server protocol (not in contracts): with PD_TEST_HOOKS=1, a live
    // server answers POST /_pd/__test/settle once every change made before it is handled (watch.ts settle).
    // On every host, so a storefront test can call it on its own origin. Without the flag it does not exist.
    if (ctx.settle && pathname === TEST_SETTLE_ROUTE) {
      if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); res.end(); return; }
      try { await ctx.settle(); res.writeHead(204); res.end(); }
      catch (e) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end(e instanceof Error ? e.message : String(e)); }
      return;
    }

    // --- Dev-UI SPA static assets (/_pd/ prefix) ---
    if (pathname === PD_ROUTES.mainJs) {
      return await serveFile(res, join(devUiDist, "main.js"), "application/javascript");
    }
    if (pathname === PD_ROUTES.mainCss) {
      return await serveFile(res, join(devUiDist, "main.css"), "text/css");
    }
    if (pathname === PD_ROUTES.axeCore) {
      return await serveFile(res, resolveAxeCore(import.meta.url), "application/javascript");
    }
    if (pathname === PD_ROUTES.ruleTiers) {
      json(res, 200, ruleTiers satisfies RuleTiers);
      return;
    }
    if (pathname === PD_ROUTES.shikiCss) {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(getShikiCSS());
      return;
    }
    // Code token colours: the workbench's, and a site page's when it shows code (page.ts links it).
    if (pathname === PD_ROUTES.codeCss) {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(getCodeCSS());
      return;
    }

    // --- Document-base layer (reset + font-face; no component rules) ---
    if (pathname === PD_ROUTES.baseCss) {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(normalizeAssetRefs(state.baseCss, assetRootNames));
      return;
    }

    // --- Per-component own-origin CSS ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.componentCss) && pathname.endsWith(".css")) {
      // Query string (cache-buster) already stripped by `url.pathname`. The id is RAW, as in every
      // component-id route: producers never encode it, so decoding here would break an id with a `%`.
      const componentId = pathname.slice(PD_ROUTE_PREFIX.componentCss.length, -".css".length);
      // A component without styles gets an empty stylesheet (its preview links one either way); a name that
      // is no component is a 404, so `pd build` never follows a made-up address to write it.
      let css = state.perComponentCss.get(componentId);
      if (css === undefined) {
        const discovery = await currentDiscovery(state, patternRoots);
        if (!discovery.discoveryMap.has(componentId) && !discovery.quarantineMap.has(componentId)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Stylesheet not found");
          return;
        }
        css = "";
      }
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(normalizeAssetRefs(css, assetRootNames));
      return;
    }

    // --- Per-theme CSS ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.themeCss) && pathname.endsWith(".css")) {
      if (!themesDir) { res.writeHead(404); res.end(); return; }
      const themeName = decodeURIComponent(
        basename(pathname, ".css")
      );
      if (state.themeCss.has(themeName)) {
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end(normalizeAssetRefs(state.themeCss.get(themeName)!, assetRootNames));
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Theme not found");
      }
      return;
    }

    // --- Compiled behaviour scripts ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.script) && pathname.endsWith(".js")) {
      if (scriptsDirs.length === 0) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("No scriptsDir configured");
        return;
      }
      const decoded = decodePath(basename(pathname, ".js"));
      if (decoded === null) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Script not found"); return; }
      const scriptId = normalizeScriptId(decoded);
      try {
        const js = await compiledScript(state, scriptsDirs, scriptId);
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(js);
      } catch (e) {
        if (e instanceof ScriptMissing) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end(`No script "${scriptId}": scripts are TypeScript, so ${scriptId}.ts is expected in `
            + scriptsDirs.map(d => relative(cwd, d) || d).join(" or "));
          return;
        }
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Script compile error: ${String(e)}`);
      }
      return;
    }

    // --- A site page's social image (social-route.ts) ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.social)) return await serveSocialImage(pathname, res, cfg, ctx);

    // --- Responsive image variants (image-route.ts) ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.images)) {
      return await serveImageVariant(pathname, (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase(), res, cfg);
    }

    // --- A symbol image's standalone file (symbols.ts): the base layer's token values written in ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.symbols) && ctx.symbols) {
      const stem = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.svg$/.exec(pathname.slice(PD_ROUTE_PREFIX.symbols.length))?.[1];
      const entry = stem === undefined ? undefined : (await ctx.symbols.index()).entries.get(stem);
      if (!entry) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Symbol not found"); return; }
      const file = entry.ok ? standaloneSvg(entry.source, baseTokens(state.baseCss), cfg.symbolsCurrentColor) : { problems: entry.problem.problems };
      if (!("svg" in file)) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`${PD_ROUTE_PREFIX.symbols}${stem}.svg: ${file.problems.join("; ")}`);
        return;
      }
      res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8" });
      res.end(file.svg);
      return;
    }

    // --- Project asset serving (/assets/*) ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.assets) && assetRoots.length > 0) {
      const assetPath = await assetFile(pathname, assetRoots, assetRootNames);
      if (assetPath === null) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Asset not found");
        return;
      }
      return await serveFile(res, assetPath, mimeType(extname(assetPath)));
    }

    // --- JSON API ---
    if (pathname === PD_ROUTES.tree) {
      const discovery = await currentDiscovery(state, patternRoots);
      const tree = await buildComponentTree(patternDirs, overviewsEnabled, discovery.discoveryMap);
      json(res, 200, tree satisfies ComponentTree);
      return;
    }

    // The project graph (graph/), as its JSON: what `pd graph --json` prints and the static build writes.
    if (pathname === PD_ROUTES.graph) {
      json(res, 200, graphJson(await currentGraph(ctx)) satisfies ProjectGraphJson);
      return;
    }

    // Diagnostics graph — the whole-corpus static-defect sweep.
    // Reuses the exact per-component check unit; component nodes key on the discovery id. Persisted
    // + hash-delta: only components whose content hash changed are re-audited (§3/§4).
    if (pathname === PD_ROUTES.audit) {
      try {
        const discovery = await currentDiscovery(state, patternRoots);
        const discoveryMap = discovery.discoveryMap;
        // Cold: seed, a hash-delta vs the disk artifact (only changed components are re-audited); requests
        // during a seed share it. Warm: the slices the watcher keeps current with surgical re-audits.
        const slices = await state.audit.get(async () => {
          const editedDuringSeed = new Set<string>();
          state.auditSeeding = editedDuringSeed;
          try {
            if (verboseTiming) console.time("[dev-server:timing] diagnostics seed");
            const inputs = await auditInputs({
              discoveryMap, handleMap: discovery.handleMap, composition: await compositionFor(state, discovery, patternDirs), globalData,
              helperPaths: cfg.helperPaths, quarantine: discovery.quarantineMap,
            });
            const r = await refreshDiagnosticsGraph(cwd, auditedComponentIds(discovery), render, discovery.quarantineMap, inputs);
            await testHook()?.("audit-seed", "built", () => {});
            // The deviation from lazy.ts's rule that a value an invalidation overtook is never stored: a
            // seed is long on a large corpus, and a save during every seed would otherwise repeat the whole
            // sweep. Edits during it do not invalidate it; they are recorded, and those components are
            // audited again here, each with the hash of what it audited, before the seed is stored.
            // A structural change (a component added or removed) still invalidates it as usual.
            while (editedDuringSeed.size > 0) {
              const ids = [...editedDuringSeed];
              editedDuringSeed.clear();
              for (const id of ids) {
                if (!r.audited.has(id)) continue;
                r.audited.set(id, await auditWithHash(id, render, discovery.quarantineMap.get(id), inputs, r.audited.get(id)!.includes));
                state.liveReauditCount += 1;
              }
            }
            if (verboseTiming) {
              console.timeEnd("[dev-server:timing] diagnostics seed");
              console.log(`[dev-server:timing] diagnostics seed: re-audited ${r.reaudited.length}, reused ${r.reused} (of ${r.audited.size})`);
            }
            return r.audited;
          } finally {
            if (state.auditSeeding === editedDuringSeed) state.auditSeeding = null;
          }
        });
        const graph: DiagnosticsGraph = assembleGraph([...slices.values()].map(s => s.audit));
        // Re-persist so the disk artifact tracks the live edits (later cold starts stay fast).
        await persistSlices(cwd, slices);
        // _liveReaudits: total surgical HMR re-audits since startup — the incremental-proof instrument
        // (rises by exactly 1 per .hbs edit, 0 per .scss edit). Debug envelope field, not the graph.
        // The style couplings beside the findings, from the graph as it is now (never cached with the findings: a
        // stylesheet save re-audits nothing, so they can't live in the slices).
        const style = auditStyleOf(await currentGraph(ctx, discovery), auditedComponentIds(discovery), ctx.cfg.allowProperties);
        json(res, 200, { ...graph, generatedAt: ctx.now().toISOString(), _liveReaudits: state.liveReauditCount, style } satisfies AuditResponse);
      } catch (e) {
        json(res, 500, { error: e instanceof Error ? e.message : String(e) } satisfies ApiError);
      }
      return;
    }

    if (pathname.startsWith(PD_ROUTE_PREFIX.component)) {
      const componentId = pathname.slice(PD_ROUTE_PREFIX.component.length);
      const variant = url.searchParams.get("variant") ?? undefined;
      try {
        // Phase 1: build detail — 404 only for genuinely-missing components. A quarantined component
        // is not in the discovery map but still has a detail (200 + HANDLE_COLLISION, below).
        const discovery = await currentDiscovery(state, patternRoots);
        const { handleMap } = discovery;
        if (!discovery.discoveryMap.has(componentId) && !discovery.quarantineMap.has(componentId)) {
          json(res, 404, { error: `No component "${componentId}"` } satisfies ApiError);
          return;
        }
        // Only a component that exists (a quarantined one has a detail too) is the one on screen: the
        // workbench probes unknown routes here, and a 404 must not redirect the watcher's next reload.
        state.lastComponentId = componentId;
        // The full style build, when a save has left it to be redone: installed when stored, never one a
        // later save overtook (server-state.ts, hazard 5).
        await state.style.get(() => buildAllStyleData(styleRoots, baseComponentIds(discovery)));
        const compReg = await compositionFor(state, discovery, patternDirs);
        // Its Relationships fields are the project graph's (graph/queries.ts).
        const graph = await currentGraph(ctx, discovery);
        const detail = await buildComponentDetail(
          componentId, patternDirs, render, tracker, defaultTheme, handleMap, graph, discovery.discoveryMap,
        );

        // Phase 2: render + static checks — the single per-component check unit (also driven by
        // the corpus sweep). Quarantined → 200 + HANDLE_COLLISION (no render); render failure →
        // 200 + RENDER_ERROR, not 404.
        // A layout of a project with a website: the pages that render with it, and where each got it.
        const layouts = await layoutIndex(discovery.discoveryMap);
        const layoutName = layouts.nameOf(componentId);
        if (cfg.storefront && layoutName !== undefined) {
          // The graph's page model is read with the discovery map, so the tag and category pages its layouts generate
          // are in it too.
          detail.relationships.pages = layoutPagesOf(graph, componentId);
        }
        const quarantineEntry = discovery.quarantineMap.get(componentId);
        const checked = await checkComponent(componentId, variant, render, quarantineEntry);
        const { previewHtml } = checked;
        // The stylesheets it links by borrowing a class (info), and the custom properties it reads that nothing
        // declares (warnings): the detail only (diagnostics.ts).
        const diagnostics = quarantineEntry ? checked.diagnostics : [...checked.diagnostics,
          ...styleBorrowedDiagnostics(componentId, variant, graph),
          ...propertyUndeclaredDiagnostics(componentId, variant, graph, cfg.allowProperties)];
        // Its layout problems (layout-index.ts): a misplaced x-pd-layout, or a layout name it shares with another.
        if (!quarantineEntry) {
          for (const message of layouts.problemsOf(componentId, createDisplayPath(cwd, cfg.packages))) {
            diagnostics.push({ kind: "SCHEMA_INVALID", severity: "error", source: "schema", path: "#/x-pd-layout", message });
          }
        }

        const themeNames = themesDir ? [...state.themeCss.keys()] : [];
        const assets = await resolveDocumentAssets(cfg, state, {
          componentId, html: previewHtml, requireScripts: detail.requireScripts, requireAssets: detail.requireAssets,
          compositionRegistry: compReg, discoveryMap: discovery.discoveryMap,
        });
        const previewDoc = buildPreviewDocument(
          normalizeAssetRefs(previewHtml, assetRootNames), assets.closureIds, detail.layout, themeNames, defaultTheme,
          assets.scripts, assets.svgContents, assetsCss, componentId, undefined, assets.scriptVersions,
          documentBaseEnabled, themeSwitch, state.baseCssVersion,
          await previewTitle(componentId, variant, discovery.discoveryMap, workbenchTitle(config.shell?.brand))
        );
        json(res, 200, { ...detail, document: previewDoc, diagnostics } satisfies ComponentDetailResponse);
      } catch (e) {
        json(res, 404, { error: e instanceof Error ? e.message : String(e) } satisfies ApiError);
      }
      return;
    }

    if (pathname.startsWith(PD_ROUTE_PREFIX.overview)) {
      const folderPath = pathname.slice(PD_ROUTE_PREFIX.overview.length);
      try {
        const discovery = await currentDiscovery(state, patternRoots);
        const overview = await buildFolderOverview(folderPath, patternDirs, render, discovery.discoveryMap);
        json(res, 200, overview satisfies FolderOverview);
      } catch (e) {
        json(res, 404, { error: e instanceof Error ? e.message : String(e) } satisfies ApiError);
      }
      return;
    }

    if (pathname === PD_ROUTES.themes) {
      // The themes as the server holds them, in the picker's order (themes.ts): the same list every preview links.
      const enriched: ThemeSummary[] = cfg.themeDirs.length
        ? [...state.themeCss.keys()].map(name => ({ name, tokens: state.themeTokens.get(name) }))
        : [];
      json(res, 200, enriched satisfies ThemeSummary[]);
      return;
    }

    // Build identity, so a human (or a script) can tell whether the process answering them is
    // behind the artifacts on disk. This exists because the failure it detects is invisible:
    // `pd dev` loads packages/*/dist through package exports with no watch and no module-cache
    // invalidation, so a rebuilt bundle never reaches a running server — and the resulting failures
    // look exactly like a feature bug. Read-only, additive, and the client never sends it back.
    if (pathname === PD_ROUTES.version) {
      json(res, 200, {
        startedAt: ctx.boot.startedAt,
        serverBundleMtime: ctx.boot.serverBundleMtime,
        protocol: PD_PROTOCOL_VERSION,
      } satisfies VersionInfo);
      return;
    }

    if (pathname === PD_ROUTES.config) {
      // defaultTheme included so the shell can report the theme actually in effect. With no
      // ?theme= the preview falls back to it (see the /preview/ branch below), so without this the
      // shell had no way to know what it was showing and displayed "— no theme —" over a themed
      // document. Read-only: the client never sends it back.
      json(res, 200, { shell: config.shell ?? null, themeSwitch, defaultTheme: defaultTheme ?? "", site: cfg.storefront !== null } satisfies ShellClientConfig);
      return;
    }

    // --- Preview documents (iframe src, standalone — on-demand variants + open-in-new-tab) ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.preview)) {
      // The requested id names the document (data-component-id); what is rendered may be a variant
      // addressed by its own id, resolved below.
      const requestedId = pathname.slice(PD_ROUTE_PREFIX.preview.length);
      let componentId   = requestedId;
      let variant       = url.searchParams.get("variant") ?? undefined;
      // ?theme= bakes data-theme into <body> pre-paint (fixes one-frame flash on non-default
      // themes). Validated against the known theme set before use — unknown values fall back
      // to the config defaultTheme (same reconcile rule as the client store).
      const themeParam   = url.searchParams.get("theme") ?? undefined;
      const knownThemes  = themesDir ? [...state.themeCss.keys()] : [];
      const effectiveTheme = (themeParam && knownThemes.includes(themeParam))
        ? themeParam
        : defaultTheme;
      try {
        const discovery = await currentDiscovery(state, patternRoots);
        const { handleMap: previewHandleMap, discoveryMap: previewDiscoveryMap } = discovery;
        // A variant addressed by its own id, /preview/<base>~<variant>, is the base with that variant:
        // the same document as /preview/<base>?variant=<variant>. Resolved here, before anything is
        // looked up, so its layout, its requirements (a base's requireScript) and its CSS closure are
        // the base's — the renderer applies the same rule to its data and template.
        const tilde = requestedId.indexOf("~");
        if (variant === undefined && tilde > 0 && previewDiscoveryMap.has(requestedId.slice(0, tilde))) {
          componentId = requestedId.slice(0, tilde);
          variant = requestedId.slice(tilde + 1);
        }
        const [{ html }, layout] = await Promise.all([
          render({ component: componentId, variant }),
          resolveLayoutMode(componentId, patternDirs, previewDiscoveryMap),
        ]);
        const themeNames  = themesDir ? [...state.themeCss.keys()] : [];
        const previewComposition = await compositionFor(state, discovery, patternDirs);
        const requires    = await aggregateRequires(componentId, patternDirs, previewHandleMap, previewDiscoveryMap);
        const assets = await resolveDocumentAssets(cfg, state, {
          componentId, html, requireScripts: requires.scripts, requireAssets: requires.assets,
          compositionRegistry: previewComposition, discoveryMap: previewDiscoveryMap,
        });
        const doc = buildPreviewDocument(
          normalizeAssetRefs(html, assetRootNames), assets.closureIds, layout, themeNames, effectiveTheme,
          assets.scripts, assets.svgContents, assetsCss, requestedId, undefined, assets.scriptVersions,
          documentBaseEnabled, themeSwitch, state.baseCssVersion,
          await previewTitle(componentId, variant, previewDiscoveryMap, workbenchTitle(config.shell?.brand))
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(doc);
      } catch (e) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`Render error: ${String(e)}`);
      }
      return;
    }

    // --- Rendered-HTML source ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.source) && pathname.endsWith("/rendered")) {
      const componentId = pathname.slice(PD_ROUTE_PREFIX.source.length, -"/rendered".length);
      const variant     = url.searchParams.get("variant") ?? undefined;
      try {
        const { html } = await render({ component: componentId, variant });
        const highlighted = wrapWithCopyButton(highlight(html, "html"), html);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(highlighted);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Render error: ${String(e)}`);
      }
      return;
    }

    // --- JSON data source ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.source) && pathname.endsWith("/data")) {
      const componentId = pathname.slice(PD_ROUTE_PREFIX.source.length, -"/data".length);
      const variant     = url.searchParams.get("variant") ?? undefined;
      try {
        const discovery = await currentDiscovery(state, patternRoots);
        const lookupId = variant ? `${componentId}~${variant}` : componentId;
        const jsonFile = discovery.discoveryMap.get(lookupId)?.jsonPath;
        if (!jsonFile) throw new Error(`No data file for ${lookupId}`);
        const jsonStr     = await readFile(jsonFile, "utf-8");
        const highlighted = wrapWithCopyButton(highlight(jsonStr, "json"), jsonStr);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(highlighted);
      } catch (e) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`Data file not found: ${String(e)}`);
      }
      return;
    }

    // --- Storefront pages, on the storefront's own host ---
    // Every route above serves the same on every host (a page's iframes load /preview/, its
    // stylesheets /_pd/). What is left is the page URL space: on the storefront host it is the
    // storefront's, on the workbench's hosts the workbench's. Without a storefront config the
    // workbench's hosts are the only ones (a request for any other host was refused at the top).
    const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
    if (cfg.storefront && host === cfg.storefront.host) {
      const storefront = cfg.storefront;
      const discovery = await currentDiscovery(state, patternRoots);
      const discoveryMap = discovery.discoveryMap;
      const model = await readStorefrontPages(ctx, cfg.storefront, discoveryMap);
      // With storefront.url set, pages carry absolute URLs: the configured address in a build, and in
      // pd dev the address the browser is on (under the site's path), so every link it shows works there.
      const { siteUrl, feedSettings, siteFeeds } = siteFeedsOf(req, ctx, model);
      if (pathname === PD_ROUTES.pages) {
        if (model.problems.length) { json(res, 500, { error: model.problems.join("\n") } satisfies ApiError); return; }
        const feeds = feedSettings ? await siteFeeds() : undefined;
        // pd build stops on a feed's problem, as on a page's; pd dev shows it at the feed's address.
        if (feeds && feeds.problems.length && !ctx.live) { json(res, 500, { error: feeds.problems.join("\n") } satisfies ApiError); return; }
        // pd build stops on a mount's problem too: a missing folder, a link out of it, a file in another's place
        // (mounts.ts), checked against every file the site writes (site-output.ts).
        if (!ctx.live && storefront.mounts.length) {
          const claims = claimsOf(model, (feeds?.feeds ?? []).map(f => ({ address: f.address, source: f.feed.source })));
          const mounted = await mountProblems(storefront.mounts, cfg.cwd, claims, { roots: cfg.assetRoots, names: cfg.assetRootNames });
          if (mounted.problems.length) { json(res, 500, { error: mounted.problems.join("\n") } satisfies ApiError); return; }
        }
        for (const note of feeds?.notes ?? []) ctx.onStorefrontNote?.(note);
        json(res, 200, { pages: model.pages, nav: model.nav, ...(feeds ? { feeds: feeds.feeds.map(f => ({ address: f.address, title: f.feed.title, format: f.format, collection: f.collection?.folder ?? null })) } : {}) } satisfies StorefrontPagesResponse);
        return;
      }
      if (feedSettings && pathname.endsWith(".xml") && pathname !== PD_ROUTES.sitemap) {
        const feeds = await siteFeeds();
        const found = feeds.feeds.find(f => f.address === pathname);
        if (found) {
          if (model.problems.length || feeds.problems.length) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end([...model.problems, ...feeds.problems].join("\n"));
            return;
          }
          res.writeHead(200, { "Content-Type": `${FEED_TYPES[found.format]}; charset=utf-8` });
          res.end((found.format === "atom" ? atomXml : rssXml)(found.feed, new URL(pathname.slice(1), siteUrl).href));
          return;
        }
      }
      // Crawlers read robots.txt only at a host's root, so a site under a path has none (pd build says what to add
      // to the host's own): it is the 404 page there, like any address with no page.
      if (pathname === PD_ROUTES.robots && cfg.storefront.basePath === "/") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(storefrontRobotsTxt({ siteUrl, index: cfg.storefront.index, workbenchPath: sameHostWorkbenchPath(cfg.storefront) }));
        return;
      }
      // The sitemap needs the site's address, and a site kept out of search engines has none.
      if (pathname === PD_ROUTES.sitemap && siteUrl !== undefined && cfg.storefront.index) {
        if (model.problems.length) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end(model.problems.join("\n")); return; }
        res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
        // With sitemap: true, a mount's pages after the site's own (mounts.ts), without a date: the other tool's files say none.
        const mounted = storefront.mounts.some(m => m.sitemap) ? sitemapRoutes((await readMounts(storefront.mounts, cfg.cwd)).files) : [];
        res.end(sitemapXml([...sitemapEntries(model, siteUrl),
          ...mounted.sort().map(route => ({ url: new URL(route.slice(1), siteUrl).href, lastmod: null }))]));
        return;
      }
      // An image beside the pages (page-images.ts): the file, at its path in the pages folder. A route has no extension,
      // so it takes no page's place.
      const imagePath = decodePath(pathname) ?? "";
      if (isPageImageUrl(imagePath) && model.images.includes(imagePath.slice(1))) {
        const file = await pageImageFile(pathname, cfg.storefront.pagesDir);
        if (file !== null) return await serveFile(res, file, mimeType(extname(file)));
      }
      // A page route is a folder path; /about is /about/, as a static host serves it.
      const route = /\.[a-z0-9]+$/i.test(pathname) ? null : pathname.endsWith("/") ? pathname : `${pathname}/`;
      // An old route a page lists in redirectFrom: the page that forwards to it, as pd build writes it. One that is a
      // file (/how-to/old.html) is asked for by that path; nothing else answers it, as pd build refuses a collision.
      const old = isFileRoute(pathname) ? pathname : route;
      const movedTo = old === null ? undefined : redirectsOf(model).get(old);
      if (movedTo && !model.problems.length) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(redirectStub({ route: movedTo.route, title: movedTo.title, siteUrl, lang: cfg.storefront.lang }));
        return;
      }
      // /404.html, and every address with no page, is the site's 404 page with status 404, as a static host
      // serves it (a 404 page with problems is a 500 listing them).
      const target = pathname === PD_ROUTES.notFound || route === null || (!model.problems.length && !model.files.has(route) && !model.generated.has(route))
        ? PD_ROUTES.notFound : route;
      // In pd dev a page links to the workbench of this same process, whatever the config's build-time
      // URL; pd build passes that URL in, for the built site.
      const port = /:(\d+)$/.exec(req.headers.host ?? "")?.[1];
      const ownWorkbench = `http://${PD_HOSTS.workbench}${port ? `:${port}` : ""}/`;
      // Where page links go: the configured address in pd build (none for a site without one), else this process's
      // workbench. site.workbenchUrl for templates: the same, but undefined in a headless server given no address.
      const noWorkbench = ctx.storefrontWorkbenchUrl === false;
      const configured = ctx.storefrontWorkbenchUrl === false ? undefined : ctx.storefrontWorkbenchUrl;
      const linkWorkbenchUrl = noWorkbench ? undefined : configured ?? ownWorkbench;
      const siteWorkbenchUrl = noWorkbench ? undefined : configured ?? (ctx.live ? ownWorkbench : undefined);
      const page = await assemblePage(target, model, {
        discoveryMap, handleMap: discovery.handleMap, shown: createDisplayPath(cwd, cfg.packages),
        composition: await compositionFor(state, discovery, patternDirs), render, site: ctx.site.get(),
        ...(linkWorkbenchUrl !== undefined ? { workbenchUrl: linkWorkbenchUrl } : {}),
        ...(siteWorkbenchUrl !== undefined ? { siteWorkbenchUrl } : {}),
        head: (layoutId, html, placed) => pageStylesheets(cfg, state, discovery, layoutId, html, placed),
        symbolSets: roots => pageSymbolSets(cfg, discovery, roots),
        borrowed: roots => pageBorrowedStyles(state, discovery, patternDirs, roots),
        ...(ctx.dates ? { dates: ctx.dates } : {}),
        ...(ctx.live ? { live: { wsPort, generation: generation ?? "", basePath: cfg.storefront.basePath } } : {}),
        image: (path, as) => checkPageImage(path, assetRoots, assetRootNames,
          { written: as?.written, beside: as?.beside, pagesDir: storefront.pagesDir }),
        ...(siteUrl !== undefined ? { siteUrl } : {}),
        ...(ctx.live && storefront.mounts.length ? { mounted: new Set((await readMounts(storefront.mounts, cwd)).files.map(f => f.path)) } : {}),
        lang: cfg.storefront.lang, dateFormat: dateFormatter(cfg.storefront.lang, cfg.storefront.dates),
        ...(feedSettings && target !== PD_ROUTES.notFound ? { feeds: feedLinksFor(target, (await siteFeeds()).feeds, siteUrl!,
          typeof storefront.site?.["title"] === "string" ? storefront.site["title"] : undefined) } : {}),
        siteIndex: cfg.storefront.index, basePath: cfg.storefront.basePath,
        ...(cfg.storefront.head !== undefined ? { siteHead: { path: cfg.storefront.head, name: cfg.storefront.headName ?? cfg.storefront.head } } : {}),
        ...(cfg.storefront.image !== undefined ? { siteImage: cfg.storefront.image } : {}),
        ...(cfg.storefront.socialImages ? {
          socialComponent: cfg.storefront.socialImages.component,
          // The card's hash, over its document stamped as this host serves it; its URL when its bytes are there.
          socialCard: async (cardRoute: string, document: string, about: { page: string; variant: string; values: Record<string, unknown> }) => {
            const stamped = await stampHtml(document, hashOfFor(req, ctx), cfg.storefront!.basePath);
            const hash = cardHash(stamped, ctx.version);
            const file = await cardFile(cardRoute, hash, cardDirs(cfg)!);
            ctx.socialCards.set(cardRoute, { route: cardRoute, ...about, hash, document: stamped, ...(file !== undefined ? { file } : {}) });
            if (file !== undefined) return { path: socialImageUrl(cardRoute, hash) };
            // pd dev: a card it can render is named now and rendered when it is asked for (social-route.ts); one it
            // can't is the page's warning, as pd build's report says it (D1).
            if (!ctx.cardRenderer) return {};
            const why = await ctx.cardRenderer.unavailable();
            return why === undefined ? { path: socialImageUrl(cardRoute, hash) }
              : { note: `warning: ${about.page}: no social image: its card is missing or stale and ${why}` };
          },
        } : {}),
        ...(ctx.images ? { images: ctx.images } : {}),
        ...(ctx.symbols ? { symbols: () => ctx.symbols!.index() } : {}),
        themes: { names: themesDir ? [...state.themeCss.keys()] : [], switch: cfg.themeSwitch },
      });
      if (page.search && ctx.onSearchRecord) ctx.onSearchRecord(page.search);
      if (page.problems.length) console.error(`[site] ${route}:\n${page.problems.map(p => `  - ${p}`).join("\n")}`);
      for (const note of page.notes) {
        if (ctx.onStorefrontNote) { ctx.onStorefrontNote(note); continue; }
        // In pd dev each note is printed once per server, not on every request for the page.
        const printed = printedNotes.get(ctx) ?? new Set<string>();
        printedNotes.set(ctx, printed);
        if (!printed.has(note)) { printed.add(note); console.log(`[site] ${note}`); }
      }
      res.writeHead(page.status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page.html);
      return;
    }

    // --- The workbench's robots.txt: searchable, its previews not ---
    if (pathname === PD_ROUTES.robots) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(workbenchRobotsTxt("/"));
      return;
    }

    // --- SPA shell (workbench routes), 404 for everything else ---
    if (!servesShell(pathname, req.headers.accept)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`Not found: ${pathname}`);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildShellHtml({ mode: "live", wsPort }, config.shell?.brand));

  } catch (e) {
    console.error("[dev-server] Unhandled request error:", e);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
}
