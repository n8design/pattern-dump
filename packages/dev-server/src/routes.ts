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

import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { PD_PROTOCOL_HEADER, PD_PROTOCOL_VERSION, PD_ROUTE_PREFIX, PD_ROUTES } from "@pattern-dump/contracts";
import type {
  ApiError, AuditResponse, ComponentDetailResponse, ComponentTree, DiagnosticsGraph, FolderOverview,
  RuleTiers, ShellClientConfig, ThemeSummary, VersionInfo,
} from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { compileScriptFile } from "@pattern-dump/build";
import { getShikiCSS, highlight, wrapWithCopyButton } from "@pattern-dump/renderer";

import type { ResolvedConfig } from "./server-config.js";
import { applyStyleData, type ServerState } from "./server-state.js";
import { buildShellHtml, json, mimeType, serveFile, servesShell } from "./http-utils.js";
import { baseComponentIds } from "./discovery-index.js";
import { buildCompositionRegistry } from "./composition.js";
import { buildComponentTree } from "./component-tree.js";
import { buildComponentDetail } from "./detail.js";
import { buildFolderOverview } from "./overview.js";
import { buildPreviewDocument, buildScriptVersions, normalizeAssetRefs } from "./preview-document.js";
import { resolveLayoutMode } from "./layout-mode.js";
import { computeCssClosure, linkableClosure, withRenderedClassOwners } from "./css-closure.js";
import { aggregateRequires, loadSvgAssets, normalizeScriptId } from "./requires.js";
import { buildAllStyleData } from "./style-index.js";
import { discoverThemes } from "./themes.js";
import {
  assembleGraph, checkComponent, persistSlices, refreshDiagnosticsGraph,
} from "./diagnostics.js";
import { verboseTiming } from "./timing.js";
import { resolveAxeCore } from "./assets.js";
import { ruleTiers } from "@pattern-dump/a11y";

/** Everything the routes need, handed in explicitly rather than captured from a closure. */
export interface RouteContext {
  readonly cfg: ResolvedConfig;
  readonly state: ServerState;
  readonly render: ReturnType<typeof import("@pattern-dump/renderer").createRenderer>;
  readonly tracker: Awaited<ReturnType<typeof import("@pattern-dump/build").createSassDependencyTracker>>;
  readonly globalData: Record<string, unknown> | undefined;
  /** Resolved in index.ts — the path literal is relative to that module's location, so it is
   *  passed in rather than recomputed here at a different depth. */
  readonly devUiDist: string;
  /** Build identity captured at BOOT — see /api/version. Must be the value from startup, not a
   *  fresh stat, or it could never detect that the running process is behind its own bundle. */
  readonly boot: BootStamp;
}

/** What the running process knows about itself, frozen at startup. The wire shape adds `protocol`. */
export type BootStamp = Readonly<Omit<VersionInfo, "protocol">>;

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { cfg, state, render, tracker, globalData, devUiDist } = ctx;
  // Destructured so the chain below reads exactly as it did inside startDevServer — this move
  // changes where the handler lives, not a line of its logic.
  const {
    patternRoots, patternDirs, styleRoots,
    themesDir, defaultTheme,
    assetRoots, assetRootNames, assetsDir, assetsCss,
    scriptsDirs, withGlobalScripts,
    overviewsEnabled, documentBaseEnabled, themeSwitch, config, cwd, wsPort,
  } = cfg;

  // Every response — JSON, assets, previews, the shell — carries the protocol it was produced under.
  res.setHeader(PD_PROTOCOL_HEADER, String(PD_PROTOCOL_VERSION));

  try {
    const url      = new URL(req.url ?? "/", "http://x");
    const pathname = url.pathname;

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
      const scriptId = normalizeScriptId(decodeURIComponent(basename(pathname, ".js")));
      try {
        if (!state.scriptCache.has(scriptId)) {
          // The project's scripts first, then each package's — a project script replaces a package's.
          const entryPoint = scriptsDirs.map(d => join(d, `${scriptId}.ts`)).find(f => existsSync(f))
            ?? join(scriptsDirs[0], `${scriptId}.ts`);
          const js = await compileScriptFile(entryPoint);
          state.scriptCache.set(scriptId, js);
        }
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(state.scriptCache.get(scriptId));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Script compile error: ${String(e)}`);
      }
      return;
    }

    // --- Project asset serving (/assets/*) ---
    if (pathname.startsWith(PD_ROUTE_PREFIX.assets) && assetRoots.length > 0) {
      const tail = decodeURIComponent(pathname.slice(PD_ROUTE_PREFIX.assets.length));
      const firstSeg = tail.split("/")[0];
      // Multi-root: /assets/<rootBasename>/<rest> serves from the matching root.
      const namedIdx = assetRootNames.indexOf(firstSeg);
      const assetPath = namedIdx >= 0
        ? join(assetRoots[namedIdx], tail.slice(firstSeg.length + 1))
        : join(assetRoots[0], tail); // single-root mirror
      try {
        await stat(assetPath); // verify it exists
        return await serveFile(res, assetPath, mimeType(extname(assetPath)));
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Asset not found");
        return;
      }
    }

    // --- JSON API ---
    if (pathname === PD_ROUTES.tree) {
      if (!state.discoveryResult) state.discoveryResult = await buildDiscoveryMap(patternRoots);
      const tree = await buildComponentTree(patternDirs, overviewsEnabled, state.discoveryResult.discoveryMap);
      json(res, 200, tree satisfies ComponentTree);
      return;
    }

    // Diagnostics graph — the whole-corpus static-defect sweep.
    // Reuses the exact per-component check unit; component nodes key on the discovery id. Persisted
    // + hash-delta: only components whose content hash changed are re-audited (§3/§4).
    if (pathname === PD_ROUTES.audit) {
      try {
        if (!state.discoveryResult) state.discoveryResult = await buildDiscoveryMap(patternRoots);
        const discoveryMap = state.discoveryResult.discoveryMap;
        let graph: DiagnosticsGraph;
        if (!state.auditSlices) {
          // Cold seed: hash-delta vs the disk artifact — re-audit only changed components.
          if (verboseTiming) console.time("[dev-server:timing] diagnostics seed");
          const r = await refreshDiagnosticsGraph(
            cwd, baseComponentIds(state.discoveryResult), render, state.discoveryResult.quarantineMap, discoveryMap, globalData,
          );
          state.auditSlices = r.slices;
          graph = r.graph;
          if (verboseTiming) {
            console.timeEnd("[dev-server:timing] diagnostics seed");
            console.log(`[dev-server:timing] diagnostics seed: re-audited ${r.reaudited.length}, reused ${r.reused} (of ${state.auditSlices.size})`);
          }
        } else {
          // Warm: the graph is kept current by surgical HMR re-audits — assemble from memory, re-persist
          // so the disk artifact tracks the live edits (later cold starts stay fast).
          graph = assembleGraph([...state.auditSlices.values()]);
          await persistSlices(cwd, state.auditSlices, discoveryMap, globalData);
        }
        // _liveReaudits: total surgical HMR re-audits since startup — the incremental-proof instrument
        // (rises by exactly 1 per .hbs edit, 0 per .scss edit). Debug envelope field, not the graph.
        json(res, 200, { ...graph, generatedAt: new Date().toISOString(), _liveReaudits: state.liveReauditCount } satisfies AuditResponse);
      } catch (e) {
        json(res, 500, { error: e instanceof Error ? e.message : String(e) } satisfies ApiError);
      }
      return;
    }

    if (pathname.startsWith(PD_ROUTE_PREFIX.component)) {
      const componentId = pathname.slice(PD_ROUTE_PREFIX.component.length);
      const variant = url.searchParams.get("variant") ?? undefined;
      state.lastComponentId = componentId;
      try {
        // Phase 1: build detail — throws 404 only for genuinely-missing components.
        if (!state.discoveryResult) state.discoveryResult = await buildDiscoveryMap(patternRoots);
        const { handleMap } = state.discoveryResult;
        if (state.scssGraphDirty) {
          const ids = baseComponentIds(state.discoveryResult);
          const styleData = await buildAllStyleData(styleRoots, ids);
          applyStyleData(state, styleData);
        }
        if (!state.compositionRegistry) {
          state.compositionRegistry = await buildCompositionRegistry(patternDirs, handleMap, state.discoveryResult.discoveryMap);
        }
        const compReg = state.compositionRegistry;
        const detail = await buildComponentDetail(
          componentId, patternDirs, render, tracker, defaultTheme, handleMap, compReg,
          state.scssModuleGraph ?? undefined, state.classOwnerIndex ?? undefined,
          state.discoveryResult.discoveryMap, state.baseProvenance ?? undefined
        );

        // Phase 2: render + static checks — the single per-component check unit (also driven by
        // the corpus sweep). Quarantined → 200 + HANDLE_COLLISION (no render); render failure →
        // 200 + RENDER_ERROR, not 404.
        const quarantineEntry = state.discoveryResult.quarantineMap.get(componentId);
        const { previewHtml, diagnostics } = await checkComponent(componentId, variant, render, quarantineEntry);

        const themeNames = themesDir ? [...state.themeCss.keys()] : [];
        const svgContents = detail.requireAssets && assetsDir
          ? await loadSvgAssets(detail.requireAssets, assetsDir)
          : [];
        const closureIds = withRenderedClassOwners(await computeCssClosure(
          componentId, compReg, patternDirs, state.classOwnerIndex ?? new Map(), state.discoveryResult!.discoveryMap
        ), previewHtml, state.classOwnerIndex ?? new Map());
        const previewScripts = withGlobalScripts(detail.requireScripts);
        const scriptVersions = scriptsDirs.length && previewScripts.length
          ? await buildScriptVersions(previewScripts, scriptsDirs)
          : undefined;
        const previewDoc = buildPreviewDocument(
          normalizeAssetRefs(previewHtml, assetRootNames), linkableClosure(closureIds, state.perComponentCss), detail.layout, themeNames, defaultTheme,
          previewScripts, svgContents, assetsCss, componentId, undefined, scriptVersions,
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
        if (!state.discoveryResult) state.discoveryResult = await buildDiscoveryMap(patternRoots);
        const overview = await buildFolderOverview(folderPath, patternDirs, render, state.discoveryResult.discoveryMap);
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
      const componentId = pathname.slice(PD_ROUTE_PREFIX.preview.length);
      const variant     = url.searchParams.get("variant") ?? undefined;
      // ?theme= bakes data-theme into <body> pre-paint (fixes one-frame flash on non-default
      // themes). Validated against the known theme set before use — unknown values fall back
      // to the config defaultTheme (same reconcile rule as the client store).
      const themeParam   = url.searchParams.get("theme") ?? undefined;
      const knownThemes  = themesDir ? [...state.themeCss.keys()] : [];
      const effectiveTheme = (themeParam && knownThemes.includes(themeParam))
        ? themeParam
        : defaultTheme;
      try {
        if (!state.discoveryResult) state.discoveryResult = await buildDiscoveryMap(patternRoots);
        const { handleMap: previewHandleMap, discoveryMap: previewDiscoveryMap } = state.discoveryResult;
        const [{ html }, layout] = await Promise.all([
          render({ component: componentId, variant }),
          resolveLayoutMode(componentId, patternDirs, previewDiscoveryMap),
        ]);
        const themeNames  = themesDir ? [...state.themeCss.keys()] : [];
        if (!state.compositionRegistry) {
          state.compositionRegistry = await buildCompositionRegistry(patternDirs, previewHandleMap, previewDiscoveryMap);
        }
        const requires    = await aggregateRequires(componentId, patternDirs, previewHandleMap, previewDiscoveryMap);
        const svgContents = assetsDir
          ? await loadSvgAssets(requires.assets, assetsDir)
          : [];
        const closureIds = withRenderedClassOwners(await computeCssClosure(
          componentId, state.compositionRegistry, patternDirs, state.classOwnerIndex ?? new Map(), previewDiscoveryMap
        ), html, state.classOwnerIndex ?? new Map());
        const previewScripts = withGlobalScripts(requires.scripts);
        const scriptVersions = scriptsDirs.length && previewScripts.length
          ? await buildScriptVersions(previewScripts, scriptsDirs)
          : undefined;
        const doc = buildPreviewDocument(
          normalizeAssetRefs(html, assetRootNames), linkableClosure(closureIds, state.perComponentCss), layout, themeNames, effectiveTheme,
          previewScripts, svgContents, assetsCss, componentId, undefined, scriptVersions,
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
        if (!state.discoveryResult) state.discoveryResult = await buildDiscoveryMap(patternRoots);
        const lookupId = variant ? `${componentId}~${variant}` : componentId;
        const jsonFile = state.discoveryResult.discoveryMap.get(lookupId)?.jsonPath;
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
