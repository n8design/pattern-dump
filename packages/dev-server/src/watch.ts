// The file watcher and the HMR broadcast path.
//
// The other half of the closure split: routes read and serve, this watches and broadcasts. It is
// the sole consumer of `hotreloader` — the routes never push a message — which is the clearest
// evidence the two really are separate concerns rather than a convenient cut.
//
// It is also the READER of the request->watcher back-channel: `state.lastComponentId`, written by
// GET /api/component/:id, decides which component a theme or script edit should refresh. See
// server-state.ts. That is why a second concurrent client silently redirects the first client's
// HMR, and part of why the Playwright suite runs workers:1.
//
// INCREMENTAL BY DESIGN, and there is a tripwire on it: a .hbs/.json edit re-audits exactly that
// one component; a .scss edit re-audits NOTHING, because every engine currently covered is
// CSS-invariant. Adding a CSS-sensitive rule must break diagnostics-graph.spec's asymmetry test —
// that failure is the signal to revisit this, not a flake.
//
// Guarded by test/watcher.spec.ts, which asserts both the durable HTTP effects and the broadcasts
// themselves over a real socket.

import { basename, extname, relative, resolve, sep } from "node:path";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { componentCssUrl } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { compileSassFile } from "@pattern-dump/build";
import type { HotReloader } from "@pattern-dump/hotreloader";

import type { ResolvedConfig } from "./server-config.js";
import { applyStyleData, type ServerState } from "./server-state.js";
import { baseComponentIds, resolveComponentForFile } from "./discovery-index.js";
import { buildCompositionRegistry } from "./composition.js";
import {
  computeCssClosure, linkableClosure, recomputeComponentCss, withRenderedClassOwners,
} from "./css-closure.js";
import { buildAllStyleData, documentBaseMatcher, patchClassOwnerIndex, resolveScssToComponent } from "./style-index.js";
import { auditComponent } from "./diagnostics.js";
import { extractThemeTokens } from "./themes.js";
import { surfaceCollisions, surfaceFlattening } from "./surfacing.js";
import { verboseTiming } from "./timing.js";
import { readPages, routeFor } from "./storefront/pages.js";

/** Everything the watcher needs, handed in explicitly rather than captured from a closure. */
export interface WatchContext {
  readonly cfg: ResolvedConfig;
  readonly state: ServerState;
  readonly render: ReturnType<typeof import("@pattern-dump/renderer").createRenderer>;
  readonly tracker: Awaited<ReturnType<typeof import("@pattern-dump/build").createSassDependencyTracker>>;
  readonly hotreloader: HotReloader;
}

/** Start watching the project. Returns the chokidar watcher so the caller owns teardown. */
export function startWatching(ctx: WatchContext): FSWatcher {
  const { cfg, state, render, tracker, hotreloader } = ctx;
  // Destructured so the body below reads exactly as it did inside startDevServer.
  const { patternsDir, stylesDir, styleRoots, patternRoots, patternDirs, swatchSlots, cwd } = cfg;
  // Only the PROJECT's own files are watched. Pattern packages live in node_modules: read-only
  // library code that changes by reinstalling, not by editing — so their themes and scripts are
  // not watched either.
  const themesDir = cfg.config.themes?.dir ? cfg.themesDir : null;
  const scriptsDir = cfg.config.scriptsDir ? cfg.scriptsDirs[0] ?? null : null;
  // The project's documentBase: a listed file's rules live in the base layer (see buildAllStyleData).
  const inProjectBase = documentBaseMatcher(stylesDir, cfg.config.documentBase);

// The storefront's pages folder (a folder of its own, outside patternsDir — config guarantees it).
const pagesDir = cfg.storefront?.pagesDir ?? null;
const watchDirs = [patternsDir, stylesDir, ...(themesDir ? [themesDir] : []), ...(scriptsDir ? [scriptsDir] : []), ...(pagesDir ? [pagesDir] : [])];
const watcher   = chokidar.watch(watchDirs, { ignoreInitial: true, persistent: true });

// Single source of truth for link-set membership: a component is linkable iff it has
// non-empty compiled CSS. Applied identically by the render path and the HMR reconcile
// so the preview head's link set is always computed by one rule. No CSS = no <link>.
// Shared handler for component/base SCSS file creation ("add") and edits ("change").
// Accumulates css-link-swap messages, then attaches orderedHrefs for state.lastComponentId
// computed AFTER all cache updates — so a newly-populated entry is visible in the closure.
async function handleComponentScss(filePath: string): Promise<void> {
  let recompiledFiles: string[];
  let compileErrors: Array<{ file: string; message: string }>;
  try {
    ({ recompiledFiles, errors: compileErrors } = await tracker.update(filePath));
  } catch (e) {
    // Reserved for a tracker-level failure (I/O, a bad dir). A per-file SCSS *syntax* error does NOT
    // land here — the tracker keeps going so one broken file cannot stop every other file's CSS
    // reaching the preview. Those arrive in `errors` and are pushed below.
    hotreloader.push({ type: "error", scope: "build", message: `SCSS error: ${String(e)}` });
    console.error("[dev-server] SCSS error:", e);
    return;
  }

  // Per-file compile failures. Until now these were only console.warn'ed inside the tracker, so a
  // broken .scss produced NOTHING in the workbench — the one place a design-system author looks.
  // Non-fatal by design, so report and carry on rather than returning early.
  for (const { file, message } of compileErrors) {
    hotreloader.push({
      type: "error",
      scope: "build",
      message: `SCSS ${basename(file)} — ${message.split("\n")[0]}`,
    });
  }
  state.scssGraphDirty = true;
  if (!state.discoveryResult) state.discoveryResult = await buildDiscoveryMap(patternRoots);
  const allIds = baseComponentIds(state.discoveryResult);
  const timestamp = Date.now();

  // If tracker returned no files (new file not yet registered in perFileCss),
  // treat the changed file itself as the entry point so "add" events work.
  const effectiveFiles = recompiledFiles.length > 0 ? recompiledFiles : [resolve(filePath)];

  // A recompiled file that maps to no component (a `styles.entry` bundle, or the file importing an
  // edited base partial) can change any component's CSS and the base layer, which the per-component
  // recompute below cannot see. So can an edit to a file documentBase lists, whose rules are base-layer
  // CSS even when it belongs to a component. Rebuild all style data instead and broadcast what changed.
  if (inProjectBase(resolve(filePath)) ||
      effectiveFiles.some(f => inProjectBase(resolve(f)) || !resolveScssToComponent(resolve(f), stylesDir, allIds))) {
    await restyleAll(allIds, timestamp, effectiveFiles, compileErrors.length > 0);
    return;
  }

  const pending: Array<{ type: "css-link-swap"; componentId: string; href: string }> = [];
  for (const recompiledFile of effectiveFiles) {
    const compId = resolveScssToComponent(resolve(recompiledFile), stylesDir, allIds);
    if (compId) {
      // Recompile with source map to get updated per-origin CSS for this component.
      const newCss = await recomputeComponentCss(recompiledFile, compId, stylesDir, allIds, inProjectBase);
      if (newCss !== null) {
        state.perComponentCss.set(compId, newCss);
        pending.push({
          type: "css-link-swap",
          componentId: compId,
          href: componentCssUrl(compId, timestamp),
        });
      }
    }
  }

  // Patch state.classOwnerIndex for each recompiled file so the upcoming computeCssClosure
  // sees fresh styleUses edges in the same save — avoids the navigation lag that previously
  // required a page reload to surface a new cross-component class-borrowing edge.
  // See patchClassOwnerIndex for the documented dual-ownership drift case.
  if (state.classOwnerIndex) {
    if (verboseTiming) console.time("[dev-server:timing] classOwnerIndex patch");
    for (const recompiledFile of effectiveFiles) {
      const compId = resolveScssToComponent(resolve(recompiledFile), stylesDir, allIds);
      if (compId) {
        await patchClassOwnerIndex(
          resolve(recompiledFile), compId, stylesDir, allIds, state.classOwnerIndex
        );
      }
    }
    if (verboseTiming) console.timeEnd("[dev-server:timing] classOwnerIndex patch");
  }

  const orderedHrefs = await closureHrefs(timestamp);
  for (const m of pending) hotreloader.push({ ...m, orderedHrefs });
  console.log(`[dev-server] CSS updated (recompiled: ${effectiveFiles.map(f => basename(f)).join(", ")})`);
}

// The full-restyle path: the same buildAllStyleData pass as boot and the routes' lazy rebuild, then
// a css-link-swap per component whose CSS changed. A changed base layer has no per-component link to
// bump, so the preview document is reloaded instead (content-swap, as theme edits do); it comes back
// with the base link at its new ?v= (state.baseCssVersion).
async function restyleAll(
  allIds: Set<string>, timestamp: number, files: string[], hadCompileErrors: boolean,
): Promise<void> {
  const names = files.map(f => basename(f)).join(", ");
  // A file that failed to compile is skipped by buildAllStyleData, which with one entry bundle would
  // empty every component's CSS. Keep the last good CSS on screen; the error is already on the Console.
  if (hadCompileErrors) {
    console.warn(`[dev-server] CSS not updated — compile errors (recompiled: ${names})`);
    return;
  }
  const changes = applyStyleData(state, await buildAllStyleData(styleRoots, allIds));
  const orderedHrefs = await closureHrefs(timestamp);
  for (const componentId of changes.changedComponents) {
    hotreloader.push({ type: "css-link-swap", componentId, href: componentCssUrl(componentId, timestamp), orderedHrefs });
  }
  if (changes.baseChanged && state.lastComponentId) {
    hotreloader.push({ type: "content-swap", componentId: state.lastComponentId });
  }
  // Every storefront page links the base layer, so every page changed. Said page by page: the
  // workbench's reload above names the component on screen, and there may be none.
  if (changes.baseChanged && pagesDir) {
    for (const { route } of (await readPages(pagesDir)).pages) hotreloader.push({ type: "page-changed", route });
  }
  const what = [
    `${changes.changedComponents.length} component(s)`,
    ...(changes.baseChanged ? ["base layer"] : []),
  ].join(" + ");
  console.log(`[dev-server] CSS updated: ${what} (recompiled: ${names})`);
}

// The ordered link set for the component on screen, computed after all cache updates so a
// newly-populated entry is included. Filtered to non-empty CSS: the preview head never links
// zero-CSS components.
async function closureHrefs(timestamp: number): Promise<string[] | undefined> {
  if (!state.lastComponentId || !state.discoveryResult || !state.compositionRegistry) return undefined;
  // Must match the render path, rendered-class owners included — this list REPLACES the preview's
  // links, so anything the render path added and this one lacked would be stripped on every save.
  const staticClosure = await computeCssClosure(
    state.lastComponentId, state.compositionRegistry, patternDirs, state.classOwnerIndex ?? new Map(), state.discoveryResult.discoveryMap
  );
  const renderedHtml = await render({ component: state.lastComponentId }).then(r => r.html, () => "");
  const closureIds = withRenderedClassOwners(staticClosure, renderedHtml, state.classOwnerIndex ?? new Map());
  return linkableClosure(closureIds, state.perComponentCss).map(id => componentCssUrl(id, timestamp));
}

// Markdown: component docs and folder index.md. Nothing caches them server-side — the tree, detail
// and preview routes re-read them per request — so a save only has to tell the workbench what to
// refetch. A .md's frontmatter feeds the TREE (title, status, visibility, order, a folder's
// overview:), so every edit signals tree-changed; its body and requireScript feed the component,
// so the owner gets a content-swap. A folder index.md also sets `preview:` layout for everything
// beneath it, hence the swap for the component on screen too. Adding or removing a component .md
// changes discovery (mdPath), so those rebuild it first.
async function handleMarkdown(filePath: string, event: "change" | "add" | "unlink"): Promise<void> {
  const abs = resolve(filePath);
  /** The base component documented by this file, if any — looked up by discovery's mdPath. */
  const ownerIn = (dr: ServerState["discoveryResult"]): string | undefined => {
    for (const [id, entry] of dr?.discoveryMap ?? []) {
      if (entry.mdPath && resolve(entry.mdPath) === abs) return id.split("~")[0];
    }
    return undefined;
  };
  const rel = relative(patternsDir, filePath);
  // An .hbs/.json edit drops the cached discovery (routes rebuild it lazily); the owner lookup needs one.
  if (event === "change") state.discoveryResult ??= await buildDiscoveryMap(patternRoots);
  // An unlinked file is only in the map from BEFORE the rebuild; an added one only in the map after.
  let owner = ownerIn(state.discoveryResult);
  if (event === "change") {
    hotreloader.push({ type: "tree-changed" });
    console.log(`[dev-server] Docs changed: ${rel} → tree-changed`);
  } else {
    await rebuildAndSignalTree(`Docs ${event === "add" ? "added" : "removed"}: ${rel}`);
    owner ??= ownerIn(state.discoveryResult);
  }
  for (const componentId of new Set([owner, state.lastComponentId])) {
    if (componentId) hotreloader.push({ type: "content-swap", componentId });
  }
}

// Storefront pages. Nothing is cached server-side — every page request reads the folder — so all a
// change needs is a reload of the pages it touches: an edited page reloads itself; a file or folder
// added or removed can change the nav (or the folder's problems), so every page reloads. Dotfiles are
// not pages and change nothing. Checked first, with a folder boundary, because the other handlers
// match on a path prefix.
const inPages = (p: string): boolean => pagesDir !== null && (p === pagesDir || p.startsWith(pagesDir + sep));
function handlePages(filePath: string, event: "change" | "add" | "unlink" | "addDir" | "unlinkDir"): boolean {
  if (!inPages(filePath)) return false;
  const rel = relative(pagesDir!, filePath).split(sep).join("/");
  if (rel.split("/").some(seg => seg.startsWith("."))) return true;
  const route = event === "change" && rel.endsWith(".md") ? routeFor(rel) : null;
  hotreloader.push({ type: "page-changed", route });
  console.log(`[dev-server] Page ${event}: ${rel || "."} → page-changed ${route ?? "(every page)"}`);
  return true;
}

watcher.on("addDir", (dirPath) => { handlePages(dirPath, "addDir"); });

watcher.on("change", async (filePath) => {
  if (handlePages(filePath, "change")) return;
  const ext = extname(filePath);

  if (ext === ".md" && filePath.startsWith(patternsDir)) {
    await handleMarkdown(filePath, "change");
    return;
  }

  if (ext === ".scss") {
    if (themesDir && filePath.startsWith(themesDir)) {
      // Theme SCSS changed → recompile theme, push content-swap so iframe picks up new link.
      const themeName = basename(filePath, ".theme.scss");
      try {
        const css = await compileSassFile(filePath);
        state.themeCss.set(themeName, css);
        state.themeTokens.set(themeName, await extractThemeTokens(themeName, css, swatchSlots, themesDir));
        hotreloader.push({ type: "content-swap", componentId: state.lastComponentId });
        console.log(`[dev-server] Theme CSS updated: ${themeName}`);
      } catch (e) {
        hotreloader.push({ type: "error", scope: "build", message: `SCSS error: ${String(e)}` });
      }
    } else {
      await handleComponentScss(filePath);
      // TRIPWIRE — diagnostics graph does NOT re-audit on an SCSS edit, ON PURPOSE. Every engine in
      // the sweep (structural axe on a CSS-less jsdom, html-validate, schema, render) is CSS-invariant,
      // so no style change can alter a static finding. Re-auditing here would be pure waste.
      // >>> If a CSS-DEPENDENT engine ever enters the sweep (the rendered-contrast / needsRendering
      // >>> tier — contrast, aria-hidden-focus, duplicate-id-aria), this assumption breaks: restore an
      // >>> SCSS→affected-set re-audit here (reverseDeps + resolveScssToComponent, as handleComponentScss
      // >>> already uses at ~575). Until then, omission is correct, not a miss.
    }

  } else if (ext === ".hbs" || ext === ".json") {
    // Resolve using the current map BEFORE clearing it (file was in the previous discovery pass).
    const componentId = state.discoveryResult
      ? resolveComponentForFile(filePath, state.discoveryResult)
      : null;
    // Invalidate caches so next request rebuilds with the new file state.
    state.discoveryResult = null;
    state.compositionRegistry = null;
    if (!componentId) {
      console.warn(`[dev-server] Could not resolve component for: ${filePath}`);
      return;
    }
    try {
      await render({ component: componentId });
      hotreloader.push({ type: "content-swap", componentId });
      console.log(`[dev-server] Component changed: ${componentId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      hotreloader.push({ type: "error", scope: "render", componentId, message: msg });
      console.error(`[dev-server] Render error [${componentId}]:`, msg);
    }
    // Diagnostics graph: SURGICAL re-audit of exactly this one component (template/data changed →
    // its static findings may have changed). No full re-hash, no other component touched. A base id
    // from resolveComponentForFile keys straight into the slice map. quarantineEntry is undefined —
    // a live-edited component that renders is not quarantined (collisions come via add/rebuild).
    if (state.auditSlices) {
      state.auditSlices.set(componentId, await auditComponent(componentId, render, undefined));
      state.liveReauditCount += 1;
      if (verboseTiming) console.log(`[dev-server:timing] diagnostics: live re-audit ${componentId} (1 component; total ${state.liveReauditCount})`);
    }

  } else if (ext === ".ts" && scriptsDir && filePath.startsWith(scriptsDir)) {
    // Script changed → invalidate cache + dispatch content-swap so the client re-renders
    // the srcdoc with a fresh ?v=<mtime> on the script src (busting the browser cache).
    const scriptId = basename(filePath, ".ts");
    state.scriptCache.delete(scriptId);
    if (state.lastComponentId) {
      hotreloader.push({ type: "content-swap", componentId: state.lastComponentId });
    }
    console.log(`[dev-server] Script changed: ${scriptId} → srcdoc reload dispatched`);
  }
});

// New SCSS files fire "add" (not "change"). ignoreInitial: true prevents existing files
// from firing at startup. Theme additions are ignored here (rare; handled on next nav).
// Helper: rebuild discovery, surface any collisions, then push tree-changed.
async function rebuildAndSignalTree(label: string): Promise<void> {
  const before = state.discoveryResult ? baseComponentIds(state.discoveryResult) : null;
  const dr = await buildDiscoveryMap(patternRoots);
  state.discoveryResult = dr;
  state.compositionRegistry = null;
  // A component that arrived (or left) changes who owns which stylesheet: a stylesheet saved before its
  // template was filed under the base layer, and now belongs to the component. Restyle against the new
  // set, so its CSS moves without a restart.
  const after = baseComponentIds(dr);
  if (!before || before.size !== after.size || [...after].some(id => !before.has(id))) {
    await restyleAll(after, Date.now(), [], false);
  }
  // Structural change (component added / removed) → the corpus node set changed; drop the diagnostics
  // slice cache so the next /api/audit re-seeds (still a hash-delta vs disk — only genuinely-changed
  // components re-audit). Not surgical, but adds/removes are rare and reshape the graph.
  state.auditSlices = null;
  await surfaceCollisions(dr.collisions, cwd, hotreloader);
  // Re-derive the flattening artifact — the node set changed. The registry cache was just nulled
  // for lazy rebuild, so build one locally for the pass (tree-changes are rare; cheap enough).
  const reg = await buildCompositionRegistry(patternDirs, dr.handleMap, dr.discoveryMap);
  await surfaceFlattening(dr.discoveryMap, reg, cwd);
  hotreloader.push({ type: "tree-changed" });
  console.log(`[dev-server] ${label} → tree-changed`);
}

watcher.on("add", async (filePath) => {
  if (handlePages(filePath, "add")) return;
  const ext = extname(filePath);
  if (ext === ".scss" && !(themesDir && filePath.startsWith(themesDir))) {
    await handleComponentScss(filePath);
  } else if (ext === ".hbs" && filePath.startsWith(patternsDir)) {
    await rebuildAndSignalTree(`Pattern added: ${relative(patternsDir, filePath)}`);
  } else if (ext === ".md" && filePath.startsWith(patternsDir)) {
    await handleMarkdown(filePath, "add");
  }
});

// Component template removed — rebuild discovery and signal nav rebuild.
watcher.on("unlink", async (filePath) => {
  if (handlePages(filePath, "unlink")) return;
  if (extname(filePath) === ".hbs" && filePath.startsWith(patternsDir)) {
    await rebuildAndSignalTree(`Pattern removed: ${relative(patternsDir, filePath)}`);
  } else if (extname(filePath) === ".md" && filePath.startsWith(patternsDir)) {
    await handleMarkdown(filePath, "unlink");
  }
});

// Component directory removed — covers the case where the entire component folder is deleted.
watcher.on("unlinkDir", async (dirPath) => {
  if (handlePages(dirPath, "unlinkDir")) return;
  if (dirPath.startsWith(patternsDir) && dirPath !== patternsDir) {
    await rebuildAndSignalTree(`Pattern dir removed: ${relative(patternsDir, dirPath)}`);
  }
});

  return watcher;
}
