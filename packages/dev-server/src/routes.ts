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

import type { GitDates } from "./storefront/git-dates.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, relative } from "node:path";
import { readFile } from "node:fs/promises";
import { PD_GENERATION_HEADER, PD_HOSTS, PD_PROTOCOL_HEADER, PD_PROTOCOL_VERSION, PD_ROUTE_PREFIX, PD_ROUTES } from "@pattern-dump/contracts";
import type {
  ApiError, AuditResponse, ComponentDetailResponse, ComponentTree, DiagnosticsGraph, FolderOverview, ImageLookup,
  RuleTiers, ShellClientConfig, StorefrontPagesResponse, ThemeSummary, VersionInfo,
} from "@pattern-dump/contracts";
import { getShikiCSS, highlight, wrapWithCopyButton } from "@pattern-dump/renderer";

import { sameHostWorkbenchPath } from "@pattern-dump/config";
import type { ResolvedConfig } from "./server-config.js";
import { compositionFor, currentDiscovery, type ServerState } from "./server-state.js";
import { createDisplayPath } from "./display-path.js";

/** A script with no entry point: a 404 that names where it was looked for, never stored. */
import { buildShellHtml, json, mimeType, serveFile, servesShell } from "./http-utils.js";
import { baseComponentIds } from "./discovery-index.js";
import { buildComponentTree } from "./component-tree.js";
import { buildComponentDetail } from "./detail.js";
import { buildFolderOverview } from "./overview.js";
import { buildPreviewDocument, normalizeAssetRefs } from "./preview-document.js";
import { resolveDocumentAssets } from "./document-layers.js";
import { resolveLayoutMode } from "./layout-mode.js";
import { aggregateRequires, normalizeScriptId } from "./requires.js";
import { compiledScript, ScriptMissing } from "./scripts.js";
import { contentHash } from "./content-hash.js";
import { serveImageVariant } from "./image-route.js";
import { stampCss, stampHtml, type HashOf } from "./storefront/asset-stamps.js";
import { buildAllStyleData } from "./style-index.js";
import { discoverThemes } from "./themes.js";
import {
  assembleGraph, auditWithHash, checkComponent, globalDataDigest, persistSlices, refreshDiagnosticsGraph,
} from "./diagnostics.js";
import { testHook } from "./lazy.js";
import { verboseTiming } from "./timing.js";
import { resolveAxeCore } from "./assets.js";
import { ruleTiers } from "@pattern-dump/a11y";
import { readPages } from "./storefront/pages.js";
import { assetFile } from "./asset-file.js";
import { decodePath } from "./contained-file.js";
import { isOwnHost, ownHosts } from "./own-hosts.js";
import { checkPageImage } from "./storefront/page-image.js";
import { sitemapXml, storefrontRobotsTxt, workbenchRobotsTxt, type SitemapEntry } from "./storefront/site-files.js";
import { redirectStub } from "./storefront/redirects.js";
import { assemblePage } from "./storefront/page.js";
import { pageStylesheets } from "./storefront/page-head.js";
import type { RenderingHandle } from "./rendering.js";
import type { SiteValuesHandle } from "./storefront/site-values.js";

/** Everything the routes need, handed in explicitly rather than captured from a closure. */
/** TEST ONLY (PD_TEST_HOOKS=1): where a test asks the watcher to settle. Not part of PD_ROUTES. */
export const TEST_SETTLE_ROUTE = "/_pd/__test/settle";

/** The storefront notes a server has printed (pd dev), so each is printed once. */
const printedNotes = new WeakMap<RouteContext, Set<string>>();

export interface RouteContext {
  readonly cfg: ResolvedConfig;
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
  /** false when headless (`pd build`): there is no live-reload socket, so pages carry no client for it. */
  readonly live: boolean;
  /** The current live-reload generation (PD_GENERATION_HEADER); absent when headless. */
  readonly generation?: () => string;
  /** Set by `pd build`: storefront pages link into the workbench at this address. See DevServerOptions. */
  readonly storefrontWorkbenchUrl?: string;
  /** Set by `pd build`: where a storefront page's notes go. Without it they go to the terminal. */
  readonly onStorefrontNote?: (note: string) => void;
  /** The storefront pages' dates from git, when there is a storefront (git-dates.ts). */
  readonly dates?: GitDates;
  /** TEST ONLY: set when PD_TEST_HOOKS=1 on a live server; resolves once every change so far is handled. */
  readonly settle?: () => Promise<void>;
  /** storefront.site as the server holds it now (the watcher replaces it when the config changes only it). */
  readonly site: SiteValuesHandle;
  /** The image index, ready for the current generation: a storefront page's prose images are looked up in it. */
  readonly images?: () => Promise<ImageLookup>;
}

/** What the running process knows about itself, frozen at startup. The wire shape adds `protocol`. */
export type BootStamp = Readonly<Omit<VersionInfo, "protocol">>;

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { cfg } = ctx;
  // Only requests addressed to pd dev itself: one of its own host names at the port this request came in
  // on. A page on another site that gets a name of its own to resolve to 127.0.0.1 still sends that name.
  if (!isOwnHost(req.headers.host, ownHosts(cfg.storefront?.host), req.socket.localPort ?? -1)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden: this server answers only to its own host names");
    return;
  }
  // On the storefront's host, every HTML and CSS response leaves with its references to served files
  // stamped with their content hashes (storefront/asset-stamps.ts). The workbench's hosts are not stamped.
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (cfg.storefront && host === cfg.storefront.host) return stampedResponse(req, res, ctx);
  return routeRequest(req, res, ctx);
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
      const held = holdResponse();
      const lookup = stampedResponse(self, held.res, ctx).then(() => {
        const status = held.status();
        if (status === 200) return contentHash(held.body());
        // Only "no such file" is remembered for the generation. Any other failure (a script that doesn't
        // compile, a file that can't be read) is reported and asked again by the next page.
        if (status !== 404) {
          if (hashes.get(path) === lookup) hashes.delete(path);
          console.error(`[storefront] ${path} could not be stamped: ${status} ${held.body().toString("utf8").split("\n")[0]!.slice(0, 160)}`);
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
  const type = String(held.headers["content-type"] ?? "");
  let body: Buffer | string = held.body();
  if (/^text\/html\b/.test(type)) body = await stampHtml(body.toString("utf8"), hashOfFor(req, ctx));
  else if (/^text\/css\b/.test(type)) body = await stampCss(body.toString("utf8"), hashOfFor(req, ctx));
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
      const css = getShikiCSS();
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(css);
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
      const css = state.perComponentCss.get(componentId) ?? "";
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

    // --- Responsive image variants (image-route.ts) ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.images)) {
      return await serveImageVariant(pathname, (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase(), res, cfg);
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
            const r = await refreshDiagnosticsGraph(
              cwd, baseComponentIds(discovery), render, discovery.quarantineMap, discoveryMap, globalData,
            );
            await testHook()?.("audit-seed", "built", () => {});
            // The deviation from lazy.ts's rule that a value an invalidation overtook is never stored: a
            // seed is long on a large corpus, and a save during every seed would otherwise repeat the whole
            // sweep. Edits during it do not invalidate it; they are recorded, and those components are
            // audited again here, each with the hash of what it audited, before the seed is stored.
            // A structural change (a component added or removed) still invalidates it as usual.
            const digest = globalDataDigest(globalData);
            while (editedDuringSeed.size > 0) {
              const ids = [...editedDuringSeed];
              editedDuringSeed.clear();
              for (const id of ids) {
                if (!r.audited.has(id)) continue;
                r.audited.set(id, await auditWithHash(id, render, discovery.quarantineMap.get(id), discoveryMap, digest));
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
        json(res, 200, { ...graph, generatedAt: ctx.now().toISOString(), _liveReaudits: state.liveReauditCount } satisfies AuditResponse);
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
        const detail = await buildComponentDetail(
          componentId, patternDirs, render, tracker, defaultTheme, handleMap, compReg,
          state.scssModuleGraph ?? undefined, state.classOwnerIndex ?? undefined,
          discovery.discoveryMap, state.baseProvenance ?? undefined
        );

        // Phase 2: render + static checks — the single per-component check unit (also driven by
        // the corpus sweep). Quarantined → 200 + HANDLE_COLLISION (no render); render failure →
        // 200 + RENDER_ERROR, not 404.
        const quarantineEntry = discovery.quarantineMap.get(componentId);
        const { previewHtml, diagnostics } = await checkComponent(componentId, variant, render, quarantineEntry);

        const themeNames = themesDir ? [...state.themeCss.keys()] : [];
        const assets = await resolveDocumentAssets(cfg, state, {
          componentId, html: previewHtml, requireScripts: detail.requireScripts, requireAssets: detail.requireAssets,
          compositionRegistry: compReg, discoveryMap: discovery.discoveryMap,
        });
        const previewDoc = buildPreviewDocument(
          normalizeAssetRefs(previewHtml, assetRootNames), assets.closureIds, detail.layout, themeNames, defaultTheme,
          assets.scripts, assets.svgContents, assetsCss, componentId, undefined, assets.scriptVersions,
          documentBaseEnabled, themeSwitch, state.baseCssVersion
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
      const themes = cfg.themeDirs.length ? await discoverThemes(cfg.themeDirs) : [];
      const enriched: ThemeSummary[] = themes.map(t => ({
        ...t,
        tokens: state.themeTokens.get(t.name),
      }));
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
      json(res, 200, { shell: config.shell ?? null, themeSwitch, defaultTheme: defaultTheme ?? "" } satisfies ShellClientConfig);
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
          documentBaseEnabled, themeSwitch, state.baseCssVersion
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
      const discovery = await currentDiscovery(state, patternRoots);
      const discoveryMap = discovery.discoveryMap;
      // pd dev shows drafts; pd build leaves them out, as if their files weren't there.
      const model = await readPages(cfg.storefront.pagesDir, { workbenchPath: sameHostWorkbenchPath(cfg.storefront), drafts: ctx.live ? "show" : "leave-out" });
      if (pathname === PD_ROUTES.pages) {
        if (model.problems.length) { json(res, 500, { error: model.problems.join("\n") } satisfies ApiError); return; }
        json(res, 200, { pages: model.pages, nav: model.nav } satisfies StorefrontPagesResponse);
        return;
      }
      // With storefront.url set, pages carry absolute URLs: the configured address in a build, and in
      // pd dev the address the browser is on, so every link it shows works there.
      const siteUrl = cfg.storefront.url === undefined ? undefined
        : ctx.live ? `http://${req.headers.host ?? cfg.storefront.host}/` : cfg.storefront.url;
      if (pathname === PD_ROUTES.robots) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(storefrontRobotsTxt({ siteUrl, index: cfg.storefront.index, workbenchPath: sameHostWorkbenchPath(cfg.storefront) }));
        return;
      }
      // The sitemap needs the site's address, and a site kept out of search engines has none.
      if (pathname === PD_ROUTES.sitemap && siteUrl !== undefined && cfg.storefront.index) {
        if (model.problems.length) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end(model.problems.join("\n")); return; }
        const entries: SitemapEntry[] = [];
        for (const p of [...model.pages].sort((a, b) => a.route.localeCompare(b.route))) {
          const file = model.files.get(p.route);
          if (!file || file.frontmatter.values["index"] === "false") continue;
          // A date only where git has a reliable one; a shallow clone's are left out (pages note it).
          const dated = ctx.dates ? await ctx.dates.of(file.path, ctx.live ? "dev" : "build") : undefined;
          entries.push({ url: new URL(p.route.slice(1), siteUrl).href, lastmod: dated && !dated.shallow ? dated.dates.modified : null });
        }
        res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
        res.end(sitemapXml(entries));
        return;
      }
      // A page route is a folder path; /about is /about/, as a static host serves it.
      const route = /\.[a-z0-9]+$/i.test(pathname) ? null : pathname.endsWith("/") ? pathname : `${pathname}/`;
      // An old route a page lists in redirectFrom: the page that forwards to it, as pd build writes it.
      const movedTo = route === null ? undefined : model.pages.find(p => p.redirectFrom?.includes(route));
      if (movedTo && !model.problems.length) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(redirectStub({ route: movedTo.route, title: movedTo.title, siteUrl, lang: cfg.storefront.lang }));
        return;
      }
      // /404.html, and every address with no page, is the site's 404 page with status 404, as a static host
      // serves it (a 404 page with problems is a 500 listing them).
      const target = pathname === PD_ROUTES.notFound || route === null || (!model.problems.length && !model.files.has(route))
        ? PD_ROUTES.notFound : route;
      // In pd dev a page links to the workbench of this same process, whatever the config's build-time
      // URL; pd build passes that URL in, for the built site.
      const port = /:(\d+)$/.exec(req.headers.host ?? "")?.[1];
      const page = await assemblePage(target, model, {
        discoveryMap, handleMap: discovery.handleMap, shown: createDisplayPath(cwd, cfg.packages),
        composition: await compositionFor(state, discovery, patternDirs), render, site: ctx.site.get(),
        workbenchUrl: ctx.storefrontWorkbenchUrl ?? `http://${PD_HOSTS.workbench}${port ? `:${port}` : ""}/`,
        head: (layoutId, html) => pageStylesheets(cfg, state, discovery, layoutId, html),
        ...(ctx.dates ? { dates: ctx.dates } : {}),
        ...(ctx.live ? { live: { wsPort, generation: generation ?? "" } } : {}),
        image: path => checkPageImage(path, assetRoots, assetRootNames),
        ...(siteUrl !== undefined ? { siteUrl } : {}),
        lang: cfg.storefront.lang, siteIndex: cfg.storefront.index,
        ...(cfg.storefront.image !== undefined ? { siteImage: cfg.storefront.image } : {}),
        ...(ctx.images ? { images: ctx.images } : {}),
      });
      if (page.problems.length) console.error(`[storefront] ${route}:\n${page.problems.map(p => `  - ${p}`).join("\n")}`);
      for (const note of page.notes) {
        if (ctx.onStorefrontNote) { ctx.onStorefrontNote(note); continue; }
        // In pd dev each note is printed once per server, not on every request for the page.
        const printed = printedNotes.get(ctx) ?? new Set<string>();
        printedNotes.set(ctx, printed);
        if (!printed.has(note)) { printed.add(note); console.log(`[storefront] ${note}`); }
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
    res.end(buildShellHtml({ mode: "live", wsPort }));

  } catch (e) {
    console.error("[dev-server] Unhandled request error:", e);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
}
