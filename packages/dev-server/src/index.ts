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
import { buildDiscoveryMap } from "@pattern-dump/discovery";
// Re-exported so the export/CLI orchestration (core) can key its report on the SAME handle derivation
// as discovery/export, without core depending on discovery directly.
export { deriveHandle } from "@pattern-dump/discovery";
import {
  createRenderer,
  initHighlighter, } from "@pattern-dump/renderer";
import { createSassDependencyTracker, compileSassFile } from "@pattern-dump/build";
import { createHotReloader, type HotReloader } from "@pattern-dump/hotreloader";

/** Headless servers (pd build) push nowhere: no socket is opened and nothing is retained. */
const SILENT_RELOADER: HotReloader = {
  port: 0,
  listening: Promise.resolve(),
  push() { /* no clients */ },
  retain() { /* no clients */ },
  close: async () => { /* nothing opened */ },
};
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// HTTP/HTML leaf helpers. Kept in their own module because `escapeHtml` is shared by the Markdown
// renderer, the preview-document composer and the shell builder — a shared leaf, so extracting any
// of those later cannot create a cycle back through index.ts. Not re-exported: internal to the
// package, and nothing outside it consumes these.
// Preview layout resolution — shared by the tree, detail, overview and the /preview route.
// The composition graph (uses/usedBy) + its registry type, which css-closure, flattening
// surfacing and export planning all pass around.
import { buildCompositionRegistry } from "./composition.js";
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
import { applyStyleData, createServerState } from "./server-state.js";
// Resolved paths + flags, derived once from PatternDumpConfig against the ONE resolution base.
import { resolveServerConfig } from "./server-config.js";
// HTTP route handling — takes an explicit RouteContext instead of closing over this scope.
import { handleRequest, type RouteContext, type BootStamp } from "./routes.js";
import { resolveDevUiDist } from "./assets.js";
import { describeBindError } from "./ports.js";
export { PortInUseError } from "./ports.js";
import { loadPatternPackages } from "./packages.js";
import { createDisplayPath } from "./display-path.js";
// The watcher + HMR broadcast path — the sole consumer of hotreloader.
import { startWatching } from "./watch.js";
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
  for (const p of cfg.packages) {
    console.log(`[dev-server] pattern package ${p.name}@${p.version}${p.direct ? "" : " (peer)"}${p.linked || opts.live === false ? "" : ": an installed copy, not watched"}`);
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
  const render      = createRenderer({
    patternsDir, patternRoots, themesDir: themesDir ?? undefined, defaultTheme,
    displayPath: createDisplayPath(cwd, cfg.packages),
    ...(helperRegistrars && helperRegistrars.length ? { helperRegistrars } : {}),
    ...(globalData ? { globalData } : {}),
  });
  const live = opts.live !== false;
  const hotreloader: HotReloader = live ? createHotReloader(wsPort) : SILENT_RELOADER;
  // Fail here, before compiling anything, if live reload's port is taken.
  const wsPortChosen = opts.wsPort !== undefined || process.env["PD_WS_PORT"] !== undefined;
  await hotreloader.listening.catch((e: unknown) => {
    throw describeBindError(e, wsPort, "live reload", { http: port, wsChosen: wsPortChosen });
  });

  // Main tracker: component styles only (no themes — those are served as separate linked files).
  const tracker = await createSassDependencyTracker([stylesDir]);
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
    state.discoveryResult = dr;
    await surfaceCollisions(dr.collisions, cwd, hotreloader);
    for (const o of dr.overrides) {
      console.log(`[dev-server] ${o.id} overrides ${o.shadowedSource}'s component of the same handle ("${o.handle}")`);
    }
    state.compositionRegistry = await buildCompositionRegistry(patternsDir, dr.handleMap, dr.discoveryMap);
    await surfaceFlattening(dr.discoveryMap, state.compositionRegistry, cwd);
    const allComponentIds = baseComponentIds(dr);
    const styleData = await buildAllStyleData(styleRoots, allComponentIds);
    applyStyleData(state, styleData);
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

  const routeCtx: RouteContext = {
    cfg, state, render, tracker, globalData, devUiDist, boot, now, live,
    ...(opts.storefrontWorkbenchUrl ? { storefrontWorkbenchUrl: opts.storefrontWorkbenchUrl } : {}),
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
  console.log(`[dev-server] Listening at http://127.0.0.1:${actualPort}`);
  const componentCount = state.discoveryResult ? [...state.discoveryResult.discoveryMap.keys()].filter(id => !id.includes("~")).length : 0;
  console.log(`[dev-server] Ready in ${Math.round(performance.now() - startTime)}ms — ${componentCount} components`);

  // ---- File watcher ----

  const watcher = live ? startWatching({ cfg, state, render, tracker, hotreloader }) : null;
  // Resolve only once chokidar has finished its initial scan. Until "ready", a file written into a
  // directory it has not reached yet produces no event — so an edit made right after startup (or a
  // test writing a fixture straight after startDevServer resolves) was silently missed under load.
  if (watcher) await new Promise<void>(resolve => watcher.once("ready", () => resolve()));

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
