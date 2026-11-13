// @pattern-dump/dev-server
// HTTP server + targeted HMR for `pd dev`.
// Routes:
//   /_pd/main.js|css             — dev-ui SPA bundle
//   /_pd/shiki.css               — one shared Shiki stylesheet
//   /_pd/base.css                — base-origin CSS only (reset + font-face; no component rules)
//   /_pd/components/<id>.css     — per-component own-origin CSS (origin-bucketed, no base/dep rules)
//   /_pd/themes/<name>.css       — per-theme custom-property value-sets (linked in previews)
//   /_pd/scripts/<id>.js         — ESbuild-compiled requireScript behaviour scripts
//   /assets/*                    — project asset serving (mirrors project assetsDir 1:1)
//   /api/tree                    — ComponentTree (grouped sidebar)
//   /api/component/:id           — ComponentDetail (source, doc, requireScripts, requireAssets)
//   /api/overview/:path          — FolderOverview
//   /api/themes                  — ThemeSummary[]
//   /api/config                  — ShellClientConfig (shell-facing config slice)
//   /preview/:id[?variant=x]     — standalone preview document (iframe src)
//   /source/:id/rendered         — Shiki-highlighted rendered HTML fragment
//   /source/:id/data             — Shiki-highlighted JSON data fragment
//   *                            — SPA shell
import type { PatternDumpConfig } from "@pattern-dump/config";
import { PD_HOSTS, type Render } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
// Re-exported so the export/CLI orchestration (core) can key its report on the SAME handle derivation
// as discovery/export, without core depending on discovery directly.
export { deriveHandle } from "@pattern-dump/discovery";
import {
  createRenderer,
  initHighlighter, } from "@pattern-dump/renderer";
import { createSassDependencyTracker, compileSassFile } from "@pattern-dump/build";
import { createHotReloader, type HotReloader } from "@pattern-dump/hotreloader";
import { isOwnOrigin, ownHosts } from "./own-hosts.js";

/** Headless servers (pd build) push nowhere: no socket is opened and nothing is retained. */
const SILENT_RELOADER: HotReloader = {
  port: 0,
  address: "127.0.0.1",
  listening: Promise.resolve(),
  push() { /* no clients */ },
  pushChange() { /* no clients */ },
  retain() { /* no clients */ },
  generation: () => "",
  close: async () => { /* nothing opened */ },
};
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
// HTTP/HTML leaf helpers. Kept in their own module because `escapeHtml` is shared by the Markdown
// renderer, the preview-document composer and the shell builder — a shared leaf, so extracting any
// of those later cannot create a cycle back through index.ts. Not re-exported: internal to the
// package, and nothing outside it consumes these.
// Preview layout resolution — shared by the tree, detail, overview and the /preview route.
// The composition graph (uses/usedBy) + its registry type, which css-closure, flattening
// surfacing and export planning all pass around.
// Theme discovery + swatch-token extraction.
import { discoverThemeFiles, extractThemeTokens } from "./themes.js";
// Read-only queries over the discovery index — no site reconstructs a component file path.
import { baseComponentIds } from "./discovery-index.js";
// Project helper/data loaders — one bad file is isolated and logged, never fatal.
import { loadHelperRegistrars, loadGlobalData } from "./project-loaders.js";
// Set-level findings surfaced as generated side artifacts (collisions, flattening).
import { surfaceAssetRoots, surfaceCollisions, surfaceDefaultTheme, surfaceDocumentBase, surfaceFlattening } from "./surfacing.js";
// Headless `pd audit`. Re-exported: packages/core imports it.
export { runDiagnosticsAudit } from "./audit.js";
export { buildStaticSite } from "./static-build.js";
export { withBasePath } from "./snapshot-writer.js";
export type { StaticBuildOptions, StaticBuildReport } from "./static-build.js";
// Folder overview gallery — public leaves under a group node.
// Component detail. Widest fan-out in the package — nothing may import it back.
// Shared timing gate — one flag, so the startup-build and per-save halves cannot drift apart.
// All mutable server state in one typed object — the seam that lets routes and the watcher
// stop sharing lexical scope. Its header documents the three hazards.
import { reportUnresolvableScripts } from "./requires.js";
import { applyStyleData, cachedDiscovery, compositionFor, createServerState, setDiscovery } from "./server-state.js";
// Resolved paths + flags, derived once from PatternDumpConfig against the ONE resolution base.
import { resolveServerConfig } from "./server-config.js";
import { createImageService } from "./image-service.js";
// HTTP route handling — takes an explicit RouteContext instead of closing over this scope.
import { handleRequest, type RouteContext, type BootStamp } from "./routes.js";
import { createSiteValues } from "./storefront/site-values.js";
import { resolveDevUiDist } from "./assets.js";
import { describeBindError } from "./ports.js";
export { PortInUseError } from "./ports.js";
import { loadPatternPackages } from "./packages.js";
import { createDisplayPath } from "./display-path.js";
import { createRenderingHandle, type BuildRenderer } from "./rendering.js";
import { watchedRoots } from "./watch-roots.js";
// The watcher + HMR broadcast path — the sole consumer of hotreloader.
import { startWatching, type WatchHandle } from "./watch.js";
import { createGitDates } from "./storefront/git-dates.js";
import { readPages } from "./storefront/pages.js";
// The style index — class ownership attributed from compiled CSS + source maps, and the SCSS
// module graph. Substrate for the style and style-modules graphs.
import { buildAllStyleData } from "./style-index.js";
// Per-component CSS recompile, preview link closure, and the styleUses (class-borrowing) edge.
// The diagnostics graph. `runDiagnosticsAudit` (the headless bootstrap) stays below — it wires
// config -> renderer -> discovery, which is orchestration, not graph shaping.
// Component requirement aggregation over the include tree + SVG symbol-set loading.
export { buildDiagnosticsGraph } from "./diagnostics.js";
// `pd export` I/O half (the pure shaping lives in export.ts). planExport/writeExport/
// writeThreadedIncluders are part of the package contract — packages/core imports all three.
export {
  planExport, writeExport, writeThreadedIncluders,
} from "./export-io.js";
export type { DeferredFamily, ThreadedFamily, SkippedFamily, ExportPlan } from "./export-io.js";
// The Nav Rail tree, rebuilt from the DiscoveryMap so tree and graphs share one identity.
// Preview-document composition — owns the honest-UA-page contract (CONTRIBUTING.md, "The preview is an honest page").
// `pd audit` formatters. Re-exported below: `formatAudit` + `AuditFormat` are part of the
// package contract (packages/core imports both); `formatAuditReport` is used by tests.
export { formatAudit, formatAuditReport } from "./audit-format.js";
export type { AuditFormat } from "./audit-format.js";
// Pure flattening detector — re-exported for the calibration harness and potential reuse.
export { detectFlattening, deriveSkeleton, renderFlatteningReport, defaultMetric } from "./flattening.js";
export type { Skeleton, SimilarityMetric, FlatteningInput, FlatteningOpts, FlatteningCluster } from "./flattening.js";
// Pure export-collapse shaping + shape-(a) gate + rewrite-map + include rewriter — re-exported for
// reuse/tests. planExport/writeExport (the I/O orchestration) are exported from their definitions below.
export { collapseFamily, deriveFamilyNaming, buildRewriteMap, rewriteIncludes } from "./export.js";
export type { CollapsedFamily, CollapsedVariant, FamilyMember, CollapseResult, SkipReason, SiteRewrite } from "./export.js";
// Audit view model now lives in contracts (shared with the workbench facet); re-exported here so
// existing `@pattern-dump/dev-server` consumers (CLI, tests) keep importing it from this package.
export { buildAuditRollup, AUDIT_SCOPE } from "@pattern-dump/contracts";
export type { AuditRollup, AuditRuleRollup, AuditComponentRollup } from "@pattern-dump/contracts";

export interface DevServerOptions {
  port?: number;
  wsPort?: number;
  /** false = headless: no live-reload socket and no file watcher. Used by `pd build`, which only
   *  reads the routes once. Default true. */
  live?: boolean;
  /** The clock behind the server's time stamps: the boot `startedAt` (/api/version) and the audit's
   *  `generatedAt`. Default: real time. `pd build` passes a fixed one when asked for a reproducible
   *  snapshot. */
  now?: () => Date;
  /** `pd build` only: where storefront pages link into the workbench — the built workbench's address
   *  (storefront.workbenchUrl). Without it, pages link to this process's own workbench on pd.localhost. */
  storefrontWorkbenchUrl?: string;
  /** `pd build` only: receives each note a storefront page gives (a suffixed heading anchor), for the build
   *  report. Without it, notes are printed to the terminal. */
  onStorefrontNote?: (note: string) => void;
  /** `pd dev` only: the config file, watched, and how to load it again (core owns config loading). A change
   *  to `storefront.site` alone is taken live and every storefront page reloads; any other change asks for a
   *  restart. Without them the config is read once, at start. */
  configPath?: string;
  reloadConfig?: () => Promise<PatternDumpConfig>;
}
export interface DevServer {
  port: number;
  close(): Promise<void>;
}

const devUiDist = resolveDevUiDist(import.meta.url);



export async function startDevServer(
  config: PatternDumpConfig,
  cwd: string,
  opts: DevServerOptions = {}
): Promise<DevServer> {
  const startTime = performance.now();
  const cfg = resolveServerConfig(config, cwd, opts, loadPatternPackages(config.packages, cwd));
  // Destructured so the body below reads unchanged. `cfg` is what gets handed to the extracted
  // route and watcher modules; these locals are the same values under their original names.
  const {
    port, wsPort,
    patternsDir, stylesDir, patternRoots, styleRoots,
    themesDir, defaultTheme,
    swatchSlots,
  } = cfg;
  // Said from what the watcher will watch (watch-roots.ts), so the line cannot claim what it does not do.
  const watchedFolders = Object.values(watchedRoots(cfg)).flat().map(r => typeof r === "string" ? r : "dir" in r ? r.dir : r.scope);
  for (const p of cfg.packages) {
    const watched = watchedFolders.some(d => d === p.dir || d.startsWith(p.dir + sep));
    const note = watched || opts.live === false ? "" : p.linked ? ": linked, nothing in it to watch" : ": an installed copy, not watched";
    console.log(`[dev-server] pattern package ${p.name}@${p.version}${p.direct ? "" : " (peer)"}${note}`);
  }

  await initHighlighter();

  // Project Handlebars helpers: config.helpers names a dir (or file) of helper modules, resolved
  // against the root (the single resolution base). Loaded once at startup; the renderer invokes the
  // registrars per render against its env. Absent → core helpers only (test-bench unchanged).
  // Packages' helpers load first, so a project helper with the same name replaces a package's.
  const helperRegistrars: Awaited<ReturnType<typeof loadHelperRegistrars>> = [];
  for (const path of cfg.helperPaths) helperRegistrars.push(...await loadHelperRegistrars(path));
  // Global data (config.dataDir, and each package's) merged beneath component data; packages
  // first, so the project's own data wins.
  const globalData = cfg.dataDirs.length ? await loadGlobalData(cfg.dataDirs) : undefined;
  // One rendering for everything that renders: the renderer, the global data it was built with, and its
  // helpers, replaced together in one assignment when a helper or data file is reloaded (rendering.ts).
  // A request takes `rendering.current` once; `render` always calls the current renderer.
  const displayPath = createDisplayPath(cwd, cfg.packages);
  // The images in the assets, for {{pd-image}} (image-service.ts): indexed before every render, for the generation
  // the render runs in. pd build (not live) needs every image encoded and reads every file fresh.
  let generationNow = (): string => "";
  const images = createImageService({
    assetRoots: cfg.assetRoots, assetRootNames: cfg.assetRootNames, images: cfg.images,
    ...(cfg.storefront ? { siteImages: cfg.storefront.images } : {}),
    build: opts.live === false, warn: message => console.warn(`[dev-server] ${message}`),
  });
  const buildRenderer: BuildRenderer = (registrars, data) => {
    const renderWith = createRenderer({
      patternsDir, patternRoots, themesDir: themesDir ?? undefined, defaultTheme, displayPath, images: images.lookup,
      ...(registrars.length ? { helperRegistrars: [...registrars] } : {}),
      ...(data ? { globalData: data } : {}),
    });
    return async input => { await images.ready(generationNow()); return renderWith(input); };
  };
  const rendering = createRenderingHandle(buildRenderer, helperRegistrars, globalData);
  const render: Render = input => rendering.current.render(input);
  const live = opts.live !== false;
  // A live-reload connection from a browser page is accepted only from a page pd dev served: one of its own
  // hosts, at its HTTP port (known once it listens; until then no page of it exists).
  let httpPort = -1;
  const hosts = ownHosts(cfg.storefront?.host);
  const hotreloader: HotReloader = live
    ? createHotReloader(wsPort, { acceptOrigin: origin => isOwnOrigin(origin, hosts, httpPort) })
    : SILENT_RELOADER;
  if (live) generationNow = () => hotreloader.generation();
  // Fail here, before compiling anything, if live reload's port is taken.
  const wsPortChosen = opts.wsPort !== undefined || process.env["PD_WS_PORT"] !== undefined;
  await hotreloader.listening.catch((e: unknown) => {
    throw describeBindError(e, wsPort, "live reload", { http: port, wsChosen: wsPortChosen });
  });

  // Main tracker: component styles only (no themes — those are served as separate linked files).
  // Every watched style root: the project's, and each linked package's. A package root that compiles
  // only declared entries is tracked through those (as buildAllStyleData compiles it).
  const linkedStyleRoots = styleRoots.filter(r => r.source !== undefined && cfg.packages.some(p => p.linked && p.name === r.source));
  const tracker = await createSassDependencyTracker(
    [stylesDir, ...linkedStyleRoots.filter(r => !r.entries).map(r => r.dir)],
    linkedStyleRoots.flatMap(r => r.entries ?? []),
  );
  console.log("[dev-server] SCSS compiled (dependency tracker ready)");

  // All mutable server state in one object, shared by reference with the route handlers and the
  // file watcher. See server-state.ts for the three hazards this makes explicit (the
  // lastComponentId back-channel, the in-place classOwnerIndex patch, the perComponentCss
  // reassignment).
  const state = createServerState();



  // Pre-compile all known themes.
  if (cfg.themeDirs.length) {
    for (const { name, dir } of await discoverThemeFiles(cfg.themeDirs)) {
      try {
        const css = await compileSassFile(join(dir, `${name}.theme.scss`));
        state.themeCss.set(name, css);
        const slots = config.themes?.dir && dir === cfg.themeDirs[0] ? swatchSlots : cfg.packageSwatchSlots;
        state.themeTokens.set(name, await extractThemeTokens(name, css, slots, dir));
      } catch (e) {
        console.warn(`[dev-server] Theme compile error (${name}):`, e);
        state.themeCss.set(name, "");
        state.themeTokens.set(name, Object.fromEntries(swatchSlots.map(s => [s, null])));
      }
    }
  }
  surfaceDefaultTheme(cfg.defaultTheme, [...state.themeCss.keys()]);



  // Initial index build: one compile pass per SCSS file produces all style data.
  {
    const dr = await buildDiscoveryMap(patternRoots);
    setDiscovery(state, dr);
    await surfaceCollisions(dr.collisions, cwd, hotreloader);
    for (const o of dr.overrides) {
      console.log(`[dev-server] ${o.id} overrides ${o.shadowedSource}'s component of the same handle ("${o.handle}")`);
    }
    await surfaceFlattening(dr.discoveryMap, await compositionFor(state, dr, cfg.patternDirs), cwd);
    const allComponentIds = baseComponentIds(dr);
    const styleData = await buildAllStyleData(styleRoots, allComponentIds);
    applyStyleData(state, styleData);
    state.style.set(styleData);
    await surfaceDocumentBase(styleRoots, styleData.baseOutsideList, cwd);
    surfaceAssetRoots(cfg.assetRoots, cwd);
    await reportUnresolvableScripts(dr.discoveryMap, cfg.scriptsDirs, cfg.globalScripts, cwd);
  }

  // ---- HTTP server ----

  // Build identity, captured once at boot and served from /api/version.
  //
  // `import.meta.url` IS this bundle at runtime — every @pattern-dump/* import resolves through
  // package exports to dist/index.js (esbuild --packages=external, no watch, no runtime path
  // aliases), so the file this module lives in is exactly the artifact a rebuild replaces. Reading
  // its mtime HERE, at startup, is what makes staleness detectable: compare it against the file on
  // disk later and a newer disk copy proves this process is running code that no longer exists.
  // Node has already cached the old module, so nothing short of a restart can fix that.
  //
  // Degrades to null rather than failing startup — a missing stamp must never stop the server.
  const now = opts.now ?? (() => new Date());
  const boot: BootStamp = {
    startedAt: now().toISOString(),
    serverBundleMtime: await stat(fileURLToPath(import.meta.url))
      .then(st => st.mtimeMs)
      .catch(() => null),
  };

  // storefront.site as the server holds it: replaced live by the watcher (site-values.ts).
  const site = createSiteValues(cfg.storefront?.site);
  // The storefront pages' dates from git: read once, the first time a page's layout asks for them.
  const pagesDir = cfg.storefront?.pagesDir;
  const dates = pagesDir
    ? createGitDates(pagesDir, async () => [...(await readPages(pagesDir)).files.values()].map(f => f.path))
    : undefined;
  // TEST ONLY: with PD_TEST_HOOKS=1, a live server serves POST /_pd/__test/settle (routes.ts), through the
  // watcher once it runs.
  let settleWatcher: (() => Promise<void>) | null = null;
  const testHooks = live && process.env["PD_TEST_HOOKS"] === "1";
  const routeCtx: RouteContext = {
    cfg, state, rendering, tracker, devUiDist, boot, now, live, site, ...(dates ? { dates } : {}),
    images: async () => { await images.ready(generationNow()); return images.lookup; },
    ...(testHooks ? { settle: () => settleWatcher ? settleWatcher() : Promise.reject(new Error("settle: the watcher is not running yet")) } : {}),
    ...(live ? { generation: () => hotreloader.generation() } : {}),
    ...(opts.storefrontWorkbenchUrl ? { storefrontWorkbenchUrl: opts.storefrontWorkbenchUrl } : {}),
    ...(opts.onStorefrontNote ? { onStorefrontNote: opts.onStorefrontNote } : {}),
  };
  const httpServer = createServer((req, res) => { void handleRequest(req, res, routeCtx); });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => { httpServer.off("error", reject); resolve(); });
  }).catch(async (e: unknown) => {
    await hotreloader.close().catch(() => {});
    throw describeBindError(e, port, "workbench", { http: port, wsChosen: wsPortChosen });
  });
  const actualPort = (httpServer.address() as import("node:net").AddressInfo).port;
  httpPort = actualPort;
  console.log(`[dev-server] Listening at http://127.0.0.1:${actualPort}`);
  // Where to open it, for a person reading the terminal (pd dev only; pd build runs this server too). The
  // storefront and the workbench are told apart by host name, so these are the addresses to use, not 127.0.0.1.
  if (live) {
    if (cfg.storefront) console.log(`[dev-server] Website:   http://${cfg.storefront.host}:${actualPort}/`);
    console.log(`[dev-server] Workbench: http://${cfg.storefront ? PD_HOSTS.workbench : "localhost"}:${actualPort}/`);
  }
  const startupDiscovery = await cachedDiscovery(state);
  const componentCount = startupDiscovery ? [...startupDiscovery.discoveryMap.keys()].filter(id => !id.includes("~")).length : 0;
  console.log(`[dev-server] Ready in ${Math.round(performance.now() - startTime)}ms — ${componentCount} components`);

  // ---- File watcher ----

  // Resolves once chokidar has finished its initial scan (an edit made before that would be missed). A
  // watcher that cannot start fails startup, named, after closing what is already listening.
  let watcher: WatchHandle | null = null;
  if (live) {
    try {
      watcher = await startWatching({
        cfg, state, render, rendering, tracker, hotreloader, site, config, ...(dates ? { dates } : {}),
        ...(opts.configPath && opts.reloadConfig ? { configFile: { path: opts.configPath, reload: opts.reloadConfig } } : {}),
      });
      settleWatcher = watcher.settle;
    } catch (e) {
      await hotreloader.close().catch(() => {});
      await new Promise<void>(res => httpServer.close(() => res()));
      throw e;
    }
  }

  return {
    port: actualPort,
    async close() {
      await watcher?.close();
      await hotreloader.close();
      await new Promise<void>((res, rej) =>
        httpServer.close((err) => (err ? rej(err) : res()))
      );
    },
  };
}
