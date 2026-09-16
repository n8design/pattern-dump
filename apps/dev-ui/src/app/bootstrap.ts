// Booting the shell — the strictly ordered startup sequence.
//
// ORDER IS THE CONTRACT HERE. Roughly: mount the shell, paint persisted layout before first frame,
// fetch the tree/themes/config/rule tiers in parallel, seed session, hydrate the store, populate the
// rail, initialise each region, route the current URL, restore tabs, then open the HMR socket.
//
// One step is easy to break by tidying: the persisted dock tab is SNAPSHOTTED BEFORE routing, because
// routing calls applyComponent, which resets the dock to Source/Handlebars. The snapshot is re-applied
// afterwards so a reload keeps the tab the user left on. init-order.spec.ts fails if the snapshot is
// moved after navigation.
//
// The HMR socket is opened LAST, so no push can arrive while the shell is still half-built.

import type { ComponentTree, RuleTiers, ShellClientConfig, ThemeSummary, TreeNode } from "@pattern-dump/contracts";
import { PD_ROUTES } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { store, STORAGE_KEY } from "../core/store.js";
import { runRenderedA11yScan } from "../dock/a11y-scan.js";
import { refreshDiagnostics } from "../dock/diagnostics.js";
import { renderConsole, switchDockTab } from "../dock/tabs.js";
import { renderPanel } from "../inspector/panel.js";
import { applyCvd, initA11yControl } from "../rail/a11y-control.js";
import { renderBrand } from "../rail/brand.js";
import { populateThemePicker } from "../rail/theme.js";
import { extractFolderPaths } from "../rail/tree-util.js";
import { applyPackageFilter, mountSidebar, restoreNavOpenState, syncPackageControl } from "../rail/tree.js";
import { initFullpage, openFullpage } from "../stage/fullpage.js";
import { initSplitters } from "../stage/splitters.js";
import { initDprTracking, initViewport } from "../stage/viewport.js";
import { connectHmr } from "./hmr.js";
import { auditAvailable, installStaticFetch, runtime } from "../core/runtime.js";
import { routeFromCurrentLocation } from "./router.js";
import { applyConsoleDockDom, applyRightPanelDom, mount } from "./wiring.js";

export async function init(): Promise<void> {
  // Static build: every request below goes to the snapshot (core/runtime.ts). Before any fetch.
  installStaticFetch();
  mount();
  // A static build made without the audit has no audit.json: no Audit tab (the stored-tab fallback
  // follows store.hydrate below, which would otherwise restore it).
  if (!auditAvailable) document.querySelector(".panel-tabs button[data-tab='audit']")?.remove();

  // Suppress the grid transition for the initial paint so the panel appears at its open width
  // without animating from 0. Two rAFs ensure the first frame is committed before re-enabling.
  dom.mainEl.dataset.noTransition = "";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      delete dom.mainEl.dataset.noTransition;
    });
  });

  // Wide viewport: panel open by default on first load (no stored preference yet).
  const isFirstLoad = localStorage.getItem(STORAGE_KEY) === null;
  if (isFirstLoad && window.innerWidth > 900) {
    dom.mainEl.dataset.panelOpen = "";  // visual default before hydrate sets it in the store
  }

  // Apply stored panel/dock visibility synchronously before the first await so the
  // correct layout is painted on the first frame — eliminates the default→stored flash.
  // localStorage is available immediately; the network fetch is not. We only act on
  // non-default values (panel open, dock hidden) since the DOM starts in the default state.
  if (!isFirstLoad) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as { dockVisibility?: { rightPanelOpen?: boolean; consoleDockOpen?: boolean } };
        if (stored.dockVisibility?.rightPanelOpen  === true)  applyRightPanelDom(true);
        if (stored.dockVisibility?.consoleDockOpen === false) applyConsoleDockDom(false);
      }
    } catch { /* malformed stored state — defaults are correct */ }
  }

  // Fetch rule-tiers alongside tree+themes so needsRenderingRules is always populated
  // before the first component renders — avoids an empty-race on the first rendered scan.
  const [treeRes, themeRes, configRes, tiersRes] = await Promise.all([
    fetch(PD_ROUTES.tree),
    fetch(PD_ROUTES.themes),
    fetch(PD_ROUTES.config),
    fetch(PD_ROUTES.ruleTiers).catch(() => null),
  ]);

  session.tree = await treeRes.json() as ComponentTree;
  session.themes = await themeRes.json() as ThemeSummary[];

  const shellConfig = await configRes.json() as ShellClientConfig;
  session.themeSwitch = shellConfig.themeSwitch;
  session.serverDefaultTheme = shellConfig.defaultTheme;
  renderBrand(shellConfig.shell?.brand);

  if (tiersRes) {
    const tiers = await tiersRes.json() as RuleTiers;
    session.needsRenderingRules = tiers["needsRendering"] ?? [];
  }

  // Build the component registry and nav category order from the tree.
  // /api/tree returns ALL components including private ones; visibility is present in the payload.
  function walkTree(nodes: TreeNode[]): void {
    for (const node of nodes) {
      if (node.kind === "component") {
        session.componentRegistry.set(node.path, {
          title: node.title,
          category: node.path.split("/")[0],
          visibility: node.visibility as "public" | "private" | undefined,
          ...(node.source ? { source: node.source } : {}),
        });
      }
      if (node.children) walkTree(node.children);
    }
  }
  walkTree(session.tree.roots);
  session.navCategoryOrder = new Map(session.tree.roots.map((r, i) => [r.path, i]));

  // Hydrate the store — now with real knownThemes so ?theme= URL override and theme
  // reconciliation work correctly. pd-theme moves sessionStorage → localStorage.
  const knownThemes = new Set(session.themes.map(t => t.name));
  const stripThemeParam = store.hydrate({ availableVariants: null, knownFolderPaths: extractFolderPaths(session.tree.roots), knownThemes });
  // Stored "audit" tab in a build without the audit: fall back to Docs before the panel first renders.
  if (!auditAvailable && store.local.panelTab === "audit") store.setLocal({ panelTab: "docs" });
  if (stripThemeParam) {
    // ?theme= was a shareable link override — write-through to store already done; strip param.
    const stripped = new URL(window.location.href);
    stripped.searchParams.delete("theme");
    history.replaceState(null, "", stripped.pathname + (stripped.search || "") + stripped.hash);
  }

  // Populate the theme picker after hydration so the current theme highlight is correct.
  populateThemePicker(session.themes, () => {
    // The rail->dock edge, owned here rather than inside the picker: a theme change invalidates the
    // rendered a11y results, but only the dock knows that and only while Diagnostics is open.
    if (store.local.dock.dockTab === "diagnostics") {
      session.renderedA11y = [];
      session.scanPending = true;
      refreshDiagnostics();
      requestAnimationFrame(() => void runRenderedA11yScan());
    }
  });

  // On first load with no stored state, default the right panel to open on wide viewports.
  if (isFirstLoad && window.innerWidth > 900) {
    store.setLocal({ dockVisibility: { ...store.local.dockVisibility, rightPanelOpen: true } });
  }

  // Apply stored dock/panel visibility without animating — the network fetch completes
  // long after the initial noTransition rAF window, so suppress again here.
  dom.mainEl.dataset.noTransition = "";
  applyRightPanelDom(store.local.dockVisibility.rightPanelOpen);
  applyConsoleDockDom(store.local.dockVisibility.consoleDockOpen);
  requestAnimationFrame(() => { delete dom.mainEl.dataset.noTransition; });

  // Apply stored nav filter (show-private checkbox and CSS class).
  if (store.local.navFilters.showPrivate) {
    dom.showInternalsCheck.checked = true;
    dom.sidebarTree.classList.add("show-internals");
  }
  syncPackageControl(session.tree);
  applyPackageFilter(store.local.navFilters.hidePackages);

  // Snapshot the persisted dock preference BEFORE navigation — applyComponent will reset to
  // source/hbs, and we re-apply the stored tab afterwards for reload persistence.
  const storedDockForInit = store.local.dock;

  // Tree mounts once — navigation only updates aria-current.
  mountSidebar();
  // Restore persisted nav open-state (must come after mountSidebar sets up <details> elements).
  restoreNavOpenState(store.local.navOpenPaths);

  // Publish --dpr before splitters so the dock track's round() snaps to whole device px from first paint.
  initDprTracking();
  // Splitter persistence must come after mount (DOM refs are set).
  initSplitters();
  initViewport(() => { void openFullpage(); });
  // One-shot: if CVD is active on arrival, open the panel so controls are immediately visible.
  // After hydrate the user owns the disclosure — we never force-open again during navigation.
  if (store.url.cvd.type !== "none" && store.url.cvd.severity > 0) {
    dom.a11yDetails.open = true;
  }
  applyCvd();         // CVD URL state is already set by hydrate; apply the filter before first render.
  initA11yControl();  // Sync type radiogroup + slider to store.url.cvd; wire up event handlers.
  initFullpage();

  // Deep-link: route on current URL path + optional #variant.
  await routeFromCurrentLocation();

  // Restore panel-tab button aria-selected from stored preference (renderPanel renders the
  // correct content; the button state is the only thing that needs manual sync on init).
  const storedPanelTab = store.local.panelTab;
  document.querySelectorAll<HTMLButtonElement>(".panel-tabs button[role='tab']").forEach(b => {
    b.setAttribute("aria-selected", String(b.dataset.tab === storedPanelTab));
  });
  if (storedPanelTab !== "docs") void renderPanel();

  // Cold ?vp=fullscreen deep-link: open dialog after component is loaded (awaited above).
  // current is non-null only if a component was loaded; overview URLs leave current null.
  if (store.url.viewport === "fullscreen" && session.current !== null) {
    void openFullpage();
  }

  // Restore persisted dock tab — only for component routes (applyComponent resets to
  // source/hbs; overview navigation sets its own tab and current stays null).
  if (session.current !== null && (storedDockForInit.dockTab !== "source" || storedDockForInit.sourceFacet !== "hbs")) {
    if (storedDockForInit.dockTab !== "source") {
      switchDockTab(storedDockForInit.dockTab);
    } else {
      switchDockTab("source", storedDockForInit.sourceFacet);
    }
  }

  if (runtime.mode === "static") {
    // No server behind a static build: say what this is instead of a live-reload status.
    const built = new Date(runtime.builtAt).toLocaleString();
    dom.railStatus.dataset.state = "static";
    dom.railStatusLabel.textContent = `Static build · ${built}`;
    renderConsole(`Static build of ${runtime.builtAt} (pattern-dump ${runtime.pdVersion}) — read-only snapshot, no live reload.`);
  } else {
    connectHmr();
  }
}
