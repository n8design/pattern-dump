// Mounting the shell and wiring every top-level event listener.
//
// This is where cross-region EDGES live. Regions never import each other and never import app/, so
// "clicking a tree link navigates", "a relationship chip opens its component" and "reopening the
// Audit tab retries" all have to be connected by something that sees every region at once — this
// module. That is also why the edges have stayed acyclic: the handlers live in one place rather
// than in the regions they connect.
//
// A DROPPED LISTENER IS INVISIBLE TO tsc, and may be invisible to E2E too. The extraction that
// created this file counted listener registrations across dev-ui before and after (62 both times)
// rather than trusting the typechecker. Do the same when editing here — and count CODE lines only:
//   grep -rh "\.add[E]ventListener" apps/dev-ui/src --include=*.ts | grep -v spec | grep -vE '^\s*//'
// (a plain grep once over-counted by one, because an earlier draft of this very comment named the
// method.)
//
// applyRightPanelDom / applyConsoleDockDom toggle the Inspector and the dock respectively, so they
// cannot belong to either region; bootstrap uses them too, to restore visibility before first paint.

import { dom, initDom } from "../core/dom.js";
import { session } from "../core/session.js";
import { routeHref } from "../core/runtime.js";
import { store } from "../core/store.js";
import { runRenderedA11yScan } from "../dock/a11y-scan.js";
import { refreshDiagnostics } from "../dock/diagnostics.js";
import { copyDockSource, renderConsole, switchDockTab, switchSourceFacet } from "../dock/tabs.js";
import { svgIcon } from "../icons/index.js";
import { clearAuditError } from "../inspector/audit.js";
import { renderPanel } from "../inspector/panel.js";
import { applyThemeToIframe } from "../rail/theme.js";
import { applyPackageFilter, filterTree } from "../rail/tree.js";
import { currentVpParam } from "../stage/viewport.js";
import { listenForPreviewMessages } from "../stage/preview-messages.js";
import { navigateVariants, swapVariant } from "./navigation.js";
import { routeFromCurrentLocation } from "./router.js";
import { renderShellHtml } from "./shell.js";
import { initContentHeight } from "../stage/content-height.js";
import { initContentWidth } from "../stage/content-width.js";


export function applyRightPanelDom(open: boolean): void {
  if (open) dom.mainEl.dataset.panelOpen = "";
  else delete dom.mainEl.dataset.panelOpen;
  dom.panelToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  dom.panelToggleBtn.innerHTML = svgIcon(open ? "panel-fill" : "panel");
}

export function applyConsoleDockDom(open: boolean): void {
  dom.dockEl.hidden = !open;
  if (open) delete dom.mainEl.dataset.dockHidden;
  else dom.mainEl.dataset.dockHidden = "";
  dom.dockToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  dom.dockToggleBtn.innerHTML = svgIcon(open ? "dock-fill" : "dock");
}

// ---- Mount ----

export function mount(): void {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = renderShellHtml();

  initDom(app);

  listenForPreviewMessages();
  initContentWidth();
  // A preview whose own height depends on the frame's is parked at its last steady height; say so,
  // because the frame then looks short and scrolls rather than fitting its content.
  initContentHeight(frame => {
    const id = frame.contentDocument?.body?.dataset.componentId ?? session.current?.id ?? "preview";
    renderConsole(`${id}: height depends on the preview's own height (a viewport-relative rule such as `
      + `height: 100vh), so the frame keeps its last steady height and the content scrolls inside it.`);
  });

  // Nav open-state persistence is wired by mountSidebar() — click listeners on each
  // <summary> element. Click fires only for user interaction; programmatic det.open = true
  // does NOT dispatch a click on summary, so navigation/restore/search never contaminate
  // navOpenPaths.

  dom.searchInput.addEventListener("input", () => {
    session.searchQuery = dom.searchInput.value;
    filterTree(session.searchQuery);
  });

  dom.showInternalsCheck.addEventListener("change", () => {
    const checked = dom.showInternalsCheck.checked;
    store.setLocal({ navFilters: { ...store.local.navFilters, showPrivate: checked } });
    dom.sidebarTree.classList.toggle("show-internals", checked);
  });

  dom.hidePackagesCheck.addEventListener("change", () => {
    const hide = dom.hidePackagesCheck.checked;
    store.setLocal({ navFilters: { ...store.local.navFilters, hidePackages: hide } });
    applyPackageFilter(hide);
  });

  dom.variantSelect.addEventListener("change", async () => {
    if (!session.current) return;
    const value = dom.variantSelect.value;

    if (value === "__all__") {
      history.pushState({}, "", routeHref(`/${session.current.id}/variants`) + currentVpParam());
      void navigateVariants(session.current.id);
      return;
    }

    // Switching from gallery mode → single: restore single preview and update URL.
    if (session.stageMode === "variants") {
      session.stageMode = "single";
      dom.singlePreview.hidden = false;
      dom.variantsGalleryEl.hidden = true;
    }

    const variantParam = value || undefined;
    // Push hash for variant — Back steps through variants (intended).
    const hash = variantParam ? `#${encodeURIComponent(variantParam)}` : "";
    history.pushState({}, "", routeHref(`/${session.current.id}`) + `${currentVpParam()}${hash}`);
    await swapVariant(session.current.id, variantParam ?? null);
  });

  dom.iframe.addEventListener("load", () => {
    const theme = store.local.theme;
    if (theme) applyThemeToIframe(dom.iframe, theme);
  });

  dom.sidebarTree.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const showAll = target.closest("a.tree-show-all");
    if (showAll) {
      e.preventDefault();
      const href = showAll.getAttribute("href") ?? "/";
      history.pushState({}, "", href + currentVpParam());
      void routeFromCurrentLocation();
      return;
    }

    const link = target.closest("a.tree-link");
    if (link) {
      e.preventDefault();
      const href = link.getAttribute("href") ?? "/";
      history.pushState({}, "", href + currentVpParam());
      void routeFromCurrentLocation();
    }
  });

  // Dock primary tab switcher.
  app.querySelector(".dock-tabs")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[role='tab'][data-tab]") as HTMLButtonElement | null;
    if (btn) {
      const tab = btn.dataset.tab as "source" | "html" | "console";
      switchDockTab(tab);
    }
  });

  // Source facet switcher.
  app.querySelector(".source-facets")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[role='tab'][data-facet]") as HTMLButtonElement | null;
    if (btn) {
      const facet = btn.dataset.facet as "hbs" | "data" | "schema";
      switchSourceFacet(facet);
    }
  });

  // Dock copy button.
  dom.dockCopyBtn.addEventListener("click", () => { void copyDockSource(); });

  // "Run rendered checks" button — manual re-scan trigger.
  app.querySelector(".pd-run-rendered")?.addEventListener("click", () => {
    session.renderedA11y = [];
    session.scanPending = true;
    refreshDiagnostics();
    void runRenderedA11yScan();
  });

  // Panel tabs.
  const panelTabsEl = app.querySelector(".panel-tabs") as HTMLElement;
  panelTabsEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-tab]") as HTMLButtonElement | null;
    if (!btn) return;
    const tab = btn.dataset.tab as "docs" | "relationships" | "audit";
    // Reopening the Audit tab clears a stuck error so the facet retries — see clearAuditError.
    if (tab === "audit") clearAuditError();
    store.setLocal({ panelTab: tab });
    panelTabsEl.querySelectorAll("button[role='tab']").forEach((b) => {
      (b as HTMLButtonElement).setAttribute("aria-selected", String((b as HTMLButtonElement).dataset.tab === tab));
    });
    void renderPanel();
  });

  // Shiki copy buttons in panel-content (docs tab fenced blocks).
  dom.panelContent.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest(".copy-btn") as HTMLElement | null;
    if (!btn) return;
    const raw = btn.closest("[data-raw]")?.getAttribute("data-raw") ?? "";
    try {
      await navigator.clipboard.writeText(raw);
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 1500);
    } catch { btn.textContent = "Failed"; }
  });

  // Relationship links — SPA navigation: intercept anchor click → pushState + route.
  dom.panelContent.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("a.rel-link") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "/";
    history.pushState({}, "", href + currentVpParam());
    void routeFromCurrentLocation();
  });

  // Audit facet component links — same per-surface SPA interception (no global delegate yet; that
  // refactor would touch all four existing surfaces). Soft transition; reveal-and-select is free via
  // routeFromCurrentLocation → applyComponent → setActiveTreeItem.
  dom.panelContent.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("a.audit-link") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "/";
    history.pushState({}, "", href + currentVpParam());
    void routeFromCurrentLocation();
  });

  // Pattern cross-links — resolved links navigate SPA; unresolved links are inert.
  // aria-disabled is advisory only: preventDefault is what actually neutralises the #-jump.
  dom.panelContent.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("a.pattern-link--unresolved")) {
      e.preventDefault();
      return;
    }
    const a = target.closest("a.pattern-link") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const compId  = a.dataset["patternId"];
    const variant = a.dataset["variant"];
    if (!compId) return;
    const url = routeHref(`/${compId}`) + `${currentVpParam()}${variant ? "#" + variant : ""}`;
    history.pushState({}, "", url);
    void routeFromCurrentLocation();
  });

  // Panel toggle — right panel open/closed (persisted to store.local.dockVisibility).
  dom.panelToggleBtn.addEventListener("click", () => {
    const vis = store.local.dockVisibility;
    const open = !vis.rightPanelOpen;
    store.setLocal({ dockVisibility: { ...vis, rightPanelOpen: open } });
    applyRightPanelDom(open);
  });

  // Console dock toggle — collapse/expand the dock content (persisted to store).
  dom.dockToggleBtn.addEventListener("click", () => {
    const vis = store.local.dockVisibility;
    const open = !vis.consoleDockOpen;
    store.setLocal({ dockVisibility: { ...vis, consoleDockOpen: open } });
    applyConsoleDockDom(open);
  });

  // Row-1 hover/focus label — shared slot, swaps text per button and state; AT-silent.
  const showToggleLabel = (e: Event): void => {
    const btn = (e.target as Element).closest<HTMLElement>(".rail-toggle");
    if (!btn) return;
    const open = btn.getAttribute("aria-expanded") === "true";
    dom.railToggleLabelEl.textContent = open
      ? (btn.dataset.labelOpen ?? "")
      : (btn.dataset.labelClosed ?? "");
  };
  const clearToggleLabel = (e: FocusEvent): void => {
    if (!e.relatedTarget || !dom.railToggleClusterEl.contains(e.relatedTarget as Node)) {
      dom.railToggleLabelEl.textContent = "";
    }
  };
  dom.railToggleClusterEl.addEventListener("pointerenter", showToggleLabel, true);
  dom.railToggleClusterEl.addEventListener("pointerleave", () => { dom.railToggleLabelEl.textContent = ""; });
  dom.railToggleClusterEl.addEventListener("focusin", showToggleLabel);
  dom.railToggleClusterEl.addEventListener("focusout", clearToggleLabel);

  window.addEventListener("popstate", () => {
    void routeFromCurrentLocation();
  });

  // hashchange: same-component, different variant — use the cheap swap path.
  window.addEventListener("hashchange", () => {
    if (!session.current) return;
    const newVariant = window.location.hash.slice(1) || null;
    void swapVariant(session.current.id, newVariant);
  });

  // Gallery label links — intercept to use pushState + route.
  app.querySelector(".stage")?.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest("a.gallery-label-link") as HTMLAnchorElement | null;
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute("href") ?? "/";
    const url = new URL(href, window.location.href);
    history.pushState({}, "", url.pathname + (url.search || currentVpParam()) + url.hash);
    void routeFromCurrentLocation();
  });
}
