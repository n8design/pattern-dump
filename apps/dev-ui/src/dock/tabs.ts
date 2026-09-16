// The Console dock's tab strip, source facets, copy button, lazy fetches, and Console log.
//
// The HTML and Data views are fetched LAZILY — only when their tab is selected — because both are
// per-variant and HMR-volatile, unlike the static .hbs source that rides in ComponentDetail.
//
// Note the two cache fields are not symmetric. session.renderedHtmlCache has one producer and always
// holds an extracted <pre>. session.dataCache has TWO: applyComponent stores the full Shiki container,
// fetchAndShowData stores an extracted <pre>. That is why fetchAndShowData's cache-hit path runs
// extractHighlightedPre and fetchAndShowHtml's does not — the extract is required, not redundant,
// and the two functions cannot be merged by parameterising them until that contract is unified.

import { dataSourceUrl, renderedSourceUrl } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { extractHighlightedPre } from "../core/html-util.js";
import { session } from "../core/session.js";
import { store, type DockState } from "../core/store.js";
import { runRenderedA11yScan } from "./a11y-scan.js";
import { refreshDiagnostics } from "./diagnostics.js";


// DOM-only apply for the source facet — no store write. Used by both switchDockTab
// (when restoring the stored facet) and switchSourceFacet (after its store write).
export function applySourceFacetDom(facet: "hbs" | "data" | "schema"): void {
  document.getElementById("dock-tab-source")?.setAttribute("aria-controls", `dock-panel-${facet}`);
  for (const btn of dom.dockFacetBtns) {
    btn.setAttribute("aria-selected", String(btn.dataset.facet === facet));
  }
  dom.dockHbsPanel.hidden    = facet !== "hbs";
  dom.dockDataPanel.hidden   = facet !== "data";
  dom.dockSchemaPanel.hidden = facet !== "schema";
  if (facet === "data" && session.current && session.dataCache === null) void fetchAndShowData();
  updateCopyLabel();
}

export function switchDockTab(
  tab: "source" | "html" | "diagnostics" | "console",
  forceFacet?: "hbs" | "data" | "schema",
): void {
  // Arm the rendered-a11y gate before any panel render so the diagnostics panel
  // never shows a premature all-clear during the async scan window.
  if (tab === "diagnostics" && session.current) {
    session.renderedA11y = [];
    session.scanPending = true;
  }

  // Update store — DockState union keeps sourceFacet structurally coupled to source tab.
  const prevDock = store.local.dock;
  const dock: DockState = tab === "source"
    ? { dockTab: "source", sourceFacet: forceFacet ?? (prevDock.dockTab === "source" ? prevDock.sourceFacet : "hbs") }
    : { dockTab: tab };
  store.setLocal({ dock });

  for (const btn of dom.dockTabBtns) {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
  }

  const isSource = tab === "source";
  const isHtml = tab === "html";
  dom.dockFacetsEl.hidden          = tab === "console" || tab === "diagnostics";
  dom.sourceFacetsEl.hidden        = !isSource;
  dom.dockHtmlPanel.hidden         = !isHtml;
  dom.dockDiagnosticsPanel.hidden  = tab !== "diagnostics";
  dom.dockConsolePanel.hidden      = tab !== "console";

  if (!isSource) {
    dom.dockHbsPanel.hidden    = true;
    dom.dockDataPanel.hidden   = true;
    dom.dockSchemaPanel.hidden = true;
  } else {
    const d = store.local.dock;
    if (d.dockTab === "source") applySourceFacetDom(d.sourceFacet);
  }

  if (isHtml && session.current && session.renderedHtmlCache === null) {
    void fetchAndShowHtml();
  }

  if (tab === "diagnostics" && session.current) {
    refreshDiagnostics();
    void runRenderedA11yScan();
  }

  updateCopyLabel();
}

export function switchSourceFacet(facet: "hbs" | "data" | "schema"): void {
  store.setLocal({ dock: { dockTab: "source", sourceFacet: facet } });
  applySourceFacetDom(facet);
}

// ---- Copy (active source tab) ----

export async function copyDockSource(): Promise<void> {
  const dock = store.local.dock;
  if (!session.current || dock.dockTab === "console") return;
  let raw: string;
  if (dock.dockTab === "html") {
    raw = session.rawRenderedHtml ?? "";
  } else if (dock.dockTab !== "source") {
    raw = session.current.source.schema ?? "";                           // diagnostics fallthrough
  } else if (dock.sourceFacet === "hbs") {
    raw = session.current.source.hbs;
  } else if (dock.sourceFacet === "data") {
    raw = session.dataRaw ?? session.current.source.json ?? "";
  } else {
    raw = session.current.source.schema ?? "";
  }
  const prevLabel = dom.dockCopyBtn.textContent ?? "";
  try {
    await navigator.clipboard.writeText(raw);
    dom.dockCopyBtn.textContent = "Copied!";
    setTimeout(() => { dom.dockCopyBtn.textContent = prevLabel; }, 1500);
  } catch {
    dom.dockCopyBtn.textContent = "Failed";
    setTimeout(() => { dom.dockCopyBtn.textContent = prevLabel; }, 1500);
  }
}

export function updateCopyLabel(): void {
  const dock = store.local.dock;
  let label: string;
  if (dock.dockTab === "html") {
    label = "Copy HTML";
  } else if (dock.dockTab !== "source" || dock.sourceFacet === "hbs") {
    label = "Copy Handlebars";
  } else if (dock.sourceFacet === "data") {
    label = "Copy data";
  } else {
    label = "Copy schema";
  }
  dom.dockCopyBtn.setAttribute("aria-label", label);
  dom.dockCopyBtn.textContent = label;
}


export async function fetchAndShowHtml(): Promise<void> {
  if (!session.current) return;
  if (session.renderedHtmlCache !== null) {
    dom.htmlBody.innerHTML = session.renderedHtmlCache;
    return;
  }
  dom.htmlBody.innerHTML = "<p>Loading…</p>";
  try {
    const url = renderedSourceUrl(session.current.id, session.currentVariant ?? undefined);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fullHtml = await res.text();
    const tmp = document.createElement("div");
    tmp.innerHTML = fullHtml;
    session.rawRenderedHtml = (tmp.querySelector(".shiki-container") as HTMLElement | null)?.dataset.raw ?? fullHtml;
    const pre = tmp.querySelector("pre");
    session.renderedHtmlCache = pre ? pre.outerHTML : fullHtml;
    dom.htmlBody.innerHTML = session.renderedHtmlCache;
  } catch (e) {
    dom.htmlBody.innerHTML = `<p>Error: ${String(e)}</p>`;
  }
}

// ---- Data facet (lazy, per-variant) ----

export async function fetchAndShowData(): Promise<void> {
  if (!session.current) return;
  if (session.dataCache !== null) {
    dom.dataBody.innerHTML = extractHighlightedPre(session.dataCache);
    return;
  }
  dom.dataBody.innerHTML = "<p>Loading…</p>";
  try {
    const url = dataSourceUrl(session.current.id, session.currentVariant ?? undefined);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fullHtml = await res.text();
    const tmp = document.createElement("div");
    tmp.innerHTML = fullHtml;
    session.dataRaw = (tmp.querySelector(".shiki-container") as HTMLElement | null)?.dataset.raw ?? fullHtml;
    const pre = tmp.querySelector("pre");
    session.dataCache = pre ? pre.outerHTML : fullHtml;
    dom.dataBody.innerHTML = session.dataCache;
  } catch (e) {
    dom.dataBody.innerHTML = `<p>Error: ${String(e)}</p>`;
  }
}


export function renderConsole(message: string, level: "info" | "error" = "info"): void {
  const p = document.createElement("p");
  p.textContent = message;
  // data-level, matching the [data-severity] convention the dock tabs already use, rather than a
  // bookkeeping class — see docs/development/styling.md §2/§3.
  if (level !== "info") p.dataset.level = level;
  dom.consoleEl.appendChild(p);
  dom.consoleEl.scrollTop = dom.consoleEl.scrollHeight;
}
