// Navigation — rendering every region for a selection.
//
// The first module in app/, the orchestration layer. It lives here rather than core/ because it
// genuinely has to reach into several regions at once: applyComponent alone updates the stage
// (viewport), the dock (diagnostics, tabs), the Inspector (panel) and the Nav Rail (active item).
// core/ imports nothing outside itself; app/ is the only layer allowed to import regions.
//
// The URL is the single source of truth. A link click only pushes the URL; the router then calls
// into here. Nothing in this module decides WHERE to go — only how to render what the URL says.
//
// The per-selection cache resets here are similar but NOT identical, and must not be collapsed into
// one helper: applyComponent resets the render pair and then SEEDS dataCache/dataRaw from the payload,
// while swapVariant and navigateOverview null all four. init-order.spec.ts pins the consequence.

import type { ComponentDetail, FolderOverview, TreeNode } from "@pattern-dump/contracts";
import { componentUrl, overviewUrl, previewUrl } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { extractHighlightedPre } from "../core/html-util.js";
import { routeHref } from "../core/runtime.js";
import { session } from "../core/session.js";
import { store } from "../core/store.js";
import { runRenderedA11yScan } from "../dock/a11y-scan.js";
import { refreshDiagnostics } from "../dock/diagnostics.js";
import { fetchAndShowData, fetchAndShowHtml, switchDockTab } from "../dock/tabs.js";
import { renderPanel } from "../inspector/panel.js";
import { setActiveTreeItem } from "../rail/tree.js";
import { applyViewport, isDiscoRunning, stopDisco } from "../stage/viewport.js";
import { buildVariantsGallery, renderOverview } from "./galleries.js";

// Wrap an srcdoc swap in a View Transition crossfade when supported and motion is ok.
// VT captures the old iframe pixels before the callback runs, so the crossfade is
// old-component → new-component (no white flash). Degrades to plain srcdoc= otherwise.
export function swapWithTransition(fn: () => void): void {
  if (
    document.startViewTransition &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    document.startViewTransition(fn);
  } else {
    fn();
  }
}

// ---- Apply: render all regions for a loaded ComponentDetail ----
// Called by navigate() for both the click-path and popstate-path. The URL is
// the single source of truth: iframe src and rendered-HTML tab both derive from
// the current route + variant, not from local state.

export async function applyComponent(detail: ComponentDetail, variant?: string): Promise<void> {
  session.current = detail;
  session.currentVariant = variant ?? null;
  session.renderedHtmlCache = null;
  session.rawRenderedHtml = null;

  session.stageMode = "single";
  dom.panel.hidden = false;
  dom.singlePreview.hidden = false;
  dom.categoryOverview.hidden = true;
  dom.variantsGalleryEl.hidden = true;
  dom.stageView.dataset.layout = detail.layout;
  dom.previewCaption.textContent = detail.id;

  populateVariantSelect(detail.variants);

  // Reconcile rule 1 (mirrors store.reconcile): unknown variant → clear hash, fall back to default.
  const isKnownVariant = !variant || detail.variants.some(v => v.name === variant);
  if (!isKnownVariant) {
    session.currentVariant = null;
    variant = undefined;
    history.replaceState(null, "", window.location.pathname + (window.location.search || ""));
  }

  dom.variantSelect.value = variant ?? "";
  dom.variantBar.hidden = detail.variants.length === 0;

  // If navigating to a private component, reveal the tree's private nodes so the
  // highlighted item is actually visible (regardless of current "Show private" state).
  if (session.componentRegistry.get(detail.id)?.visibility === "private" && !dom.showInternalsCheck.checked) {
    dom.showInternalsCheck.checked = true;
    dom.showInternalsCheck.dispatchEvent(new Event("change"));
  }
  // Likewise a package component opened while packages are hidden (a link, the URL, Relationships).
  if (session.componentRegistry.get(detail.id)?.source && dom.hidePackagesCheck.checked) {
    dom.hidePackagesCheck.checked = false;
    dom.hidePackagesCheck.dispatchEvent(new Event("change"));
  }

  // Default variant: use the document carried in the payload (no extra request).
  // Non-default variant: fetch the standalone preview document on demand with theme baked in.
  const previewDoc = (variant && isKnownVariant)
    ? await fetch(previewUrl(detail.id, variant, store.local.theme || undefined)).then(r => r.text())
    : detail.document;
  const _html = previewDoc ?? "";
  swapWithTransition(() => { dom.iframe.srcdoc = _html; });

  // Reset content-fit height so pd-height can set it fresh for the new component.
  dom.iframe.style.removeProperty("--vp-h");

  // Re-apply the current viewport to the new srcdoc without resetting the mode.
  if (isDiscoRunning()) stopDisco();
  applyViewport();

  delete dom.dockEl.dataset.mode;
  dom.hbsBody.innerHTML = extractHighlightedPre(detail.source.hbsHighlighted);
  dom.htmlBody.innerHTML = "";

  const hasData = detail.source.json !== undefined;
  dom.dockFacetDataBtn.hidden = !hasData;
  if (hasData) {
    session.dataCache = detail.source.jsonHighlighted ?? null;
    session.dataRaw   = detail.source.json ?? null;
    dom.dataBody.innerHTML = session.dataCache ? extractHighlightedPre(session.dataCache) : "";
  } else {
    session.dataCache = null;
    session.dataRaw   = null;
    dom.dataBody.innerHTML = "";
  }

  const hasSchema = detail.source.schema !== undefined;
  dom.dockFacetSchemaBtn.hidden = !hasSchema;
  dom.schemaBody.innerHTML = hasSchema
    ? extractHighlightedPre(detail.source.schemaHighlighted ?? "")
    : "";

  // Clear rendered findings; always scanPending = false here because applyComponent
  // immediately resets to source tab — switchDockTab("diagnostics") arms the gate
  // and starts the scan when the user actually views the panel.
  session.renderedA11y = [];
  session.scanPending = false;
  refreshDiagnostics();

  switchDockTab("source", "hbs");

  setActiveTreeItem(detail.id);

  await renderPanel();
}

// ---- Cheap variant swap (same component, different variant) ----
// Used by variantSelect.change, hashchange, and routeFromCurrentLocation when only the
// variant (hash) changes. Fetches the preview doc only — no full component detail re-fetch.

export async function swapVariant(componentId: string, variant: string | null): Promise<void> {
  if (!session.current || session.current.id !== componentId) return;
  session.currentVariant = variant;
  session.renderedHtmlCache = null;
  session.rawRenderedHtml = null;
  session.dataCache = null;
  session.dataRaw = null;
  dom.htmlBody.innerHTML = "";
  dom.dataBody.innerHTML = "";
  dom.variantSelect.value = variant ?? "";

  const previewDoc = await fetch(previewUrl(componentId, variant ?? undefined, store.local.theme || undefined)).then(r => r.text());
  swapWithTransition(() => { dom.iframe.srcdoc = previewDoc; });

  const dock = store.local.dock;
  if (dock.dockTab === "html") await fetchAndShowHtml();
  if (dock.dockTab === "source" && dock.sourceFacet === "data") await fetchAndShowData();

  // Re-fetch component detail so diagnostics + relationships stay fresh for the new variant.
  void fetch(componentUrl(componentId, variant ?? undefined))
    .then(r => r.ok ? r.json() as Promise<ComponentDetail> : Promise.reject())
    .then(d => {
      session.current = d;
      session.renderedA11y = [];
      session.scanPending = store.local.dock.dockTab === "diagnostics";
      refreshDiagnostics();
      if (store.local.dock.dockTab === "diagnostics") {
        dom.iframe.addEventListener("load", () => void runRenderedA11yScan(), { once: true });
      }
    })
    .catch(() => { /* ignore — stale detail is better than a crash */ });
}

// ---- Navigate: single component ----

export async function navigate(componentId: string, variant?: string): Promise<void> {
  try {
    const res = await fetch(componentUrl(componentId, variant));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json() as ComponentDetail;
    await applyComponent(detail, variant);
  } catch (e) {
    console.error("[pd] Navigate error:", e);
    showStageMessage(`Could not load “${componentId}”: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---- Navigate: a path the tree does not know ----

/**
 * A route that names no component or folder in the tree. A component quarantined by a handle
 * collision is left out of the tree but still has a detail route, so ask the server first; only
 * when it has nothing either is the route unknown.
 */
export async function navigateUnknown(path: string, variant?: string): Promise<void> {
  const res = await fetch(componentUrl(path, variant)).catch(() => null);
  if (res?.ok) {
    await applyComponent(await res.json() as ComponentDetail, variant);
    return;
  }
  showStageMessage(`No component or folder “${path}”.`, closestPaths(path));
}

/** Up to three tree paths that `path` probably meant: the same name elsewhere first, then small typos. */
function closestPaths(path: string): string[] {
  const all: string[] = [];
  const walk = (nodes: TreeNode[]) => { for (const n of nodes) { all.push(n.path); if (n.children) walk(n.children); } };
  walk(session.tree.roots);
  const name = path.split("/").pop() ?? path;
  const sameName = all.filter(p => p.split("/").pop() === name);
  const near = all
    .map(p => ({ p, d: editDistance(p, path) }))
    .filter(({ p, d }) => d <= Math.max(2, Math.floor(path.length / 5)) && !sameName.includes(p))
    .sort((a, b) => a.d - b.d)
    .map(({ p }) => p);
  return [...sameName, ...near].slice(0, 3);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// ---- The Stage without a component: folder pages and messages ----

/** Leave the component view: no current component, the folder area shown, source tabs hidden. */
function showFolderArea(activePath: string): void {
  session.current = null;
  session.currentVariant = null;
  session.renderedHtmlCache = null;
  session.rawRenderedHtml = null;
  session.dataCache = null;
  session.dataRaw = null;

  session.stageMode = "single";
  dom.variantBar.hidden = true;
  dom.panel.hidden = true;
  dom.singlePreview.hidden = true;
  dom.categoryOverview.hidden = false;
  dom.variantsGalleryEl.hidden = true;
  dom.stageView.removeAttribute("data-layout");

  // Overview: hide source tabs, switch to console.
  dom.dockEl.dataset.mode = "overview";
  switchDockTab("console");

  setActiveTreeItem(activePath);
}

/**
 * Say something in the Stage instead of showing a preview: an unknown route, or a view that failed
 * to load. Suggestions are component or folder paths, offered as links.
 */
export function showStageMessage(message: string, suggestions: string[] = []): void {
  showFolderArea("");
  dom.categoryOverview.innerHTML = "";
  const box = document.createElement("div");
  box.className = "stage-message";
  box.setAttribute("role", "status");
  const p = document.createElement("p");
  p.textContent = message;
  box.appendChild(p);
  if (suggestions.length > 0) {
    const intro = document.createElement("p");
    intro.textContent = "Did you mean:";
    const list = document.createElement("ul");
    for (const s of suggestions) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = routeHref(`/${s}`);
      a.textContent = s;
      li.appendChild(a);
      list.appendChild(li);
    }
    box.append(intro, list);
  }
  dom.categoryOverview.appendChild(box);
}

// ---- Navigate: folder overview ----

export async function navigateOverview(folderPath: string): Promise<void> {
  try {
    const res = await fetch(overviewUrl(folderPath));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const overview = await res.json() as FolderOverview;
    showFolderArea(folderPath);
    renderOverview(overview);
    await renderPanel();
  } catch (e) {
    console.error("[pd] Overview error:", e);
    showStageMessage(`Could not load “${folderPath}”: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---- Navigate: variants gallery ----

export async function navigateVariants(componentId: string): Promise<void> {
  try {
    if (!session.current || session.current.id !== componentId) {
      const res = await fetch(componentUrl(componentId));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      session.current = await res.json() as ComponentDetail;
    }
    session.currentVariant = null;
    session.renderedHtmlCache = null;
    session.rawRenderedHtml = null;
    session.dataCache = null;
    session.dataRaw = null;
    session.stageMode = "variants";

    dom.panel.hidden = false;
    dom.singlePreview.hidden = true;
    dom.categoryOverview.hidden = true;
    dom.variantsGalleryEl.hidden = false;
    dom.stageView.dataset.layout = session.current.layout;

    populateVariantSelect(session.current.variants);
    dom.variantSelect.value = "__all__";
    dom.variantBar.hidden = false;

    void buildVariantsGallery();

    delete dom.dockEl.dataset.mode;
    dom.hbsBody.innerHTML = extractHighlightedPre(session.current.source.hbsHighlighted);
    dom.htmlBody.innerHTML = "";

    const hasData = session.current.source.json !== undefined;
    dom.dockFacetDataBtn.hidden = !hasData;
    if (hasData) {
      session.dataCache = session.current.source.jsonHighlighted ?? null;
      session.dataRaw   = session.current.source.json ?? null;
      dom.dataBody.innerHTML = session.dataCache ? extractHighlightedPre(session.dataCache) : "";
    } else {
      session.dataCache = null;
      session.dataRaw   = null;
      dom.dataBody.innerHTML = "";
    }

    const hasSchema = session.current.source.schema !== undefined;
    dom.dockFacetSchemaBtn.hidden = !hasSchema;
    dom.schemaBody.innerHTML = hasSchema
      ? extractHighlightedPre(session.current.source.schemaHighlighted ?? "")
      : "";

    switchDockTab("source", "hbs");

    setActiveTreeItem(componentId);
    await renderPanel();
  } catch (e) {
    console.error("[pd] Variants navigate error:", e);
  }
}

export function populateVariantSelect(variants: ComponentDetail["variants"]): void {
  dom.variantSelect.innerHTML = '<option value="">default</option>';
  for (const v of variants) {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = v.name;
    dom.variantSelect.appendChild(opt);
  }
  if (variants.length > 0) {
    dom.variantSelect.appendChild(document.createElement("hr"));
    const allOpt = document.createElement("option");
    allOpt.value = "__all__";
    allOpt.textContent = "All variants";
    dom.variantSelect.appendChild(allOpt);
  }
}
