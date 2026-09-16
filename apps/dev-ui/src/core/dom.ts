// Every DOM reference the shell holds, in one object.
//
// These were ~58 module-level `let`s assigned once inside mount(). That made mount() a hard wall:
// every other region's refs were `undefined` until its assignment block had run, so no region could
// move out of main.ts without dragging mount() along. One object populated by initDom() gives the
// same references through an explicit seam.
//
// A MUTABLE OBJECT, NOT LAZY GETTERS. A getter form (`get iframe() { return
// document.getElementById(...) }`) reads more elegantly and is wrong here, in two concrete ways:
//
//   1. `dockTabBtns` and `dockFacetBtns` are `Array.from(querySelectorAll(...))` — snapshotted ONCE.
//      A getter would re-snapshot per access, handing out a fresh array object each time. Listener
//      wiring that iterates them would attach to different elements than a later removeEventListener
//      would look up, and the removal would silently no-op.
//   2. `markOverlay` is CREATED, not queried (see initDom below) — there is no selector to lazily
//      resolve it from without inventing create-or-find semantics.
//
// Both would be behaviour changes smuggled into what must be a pure move.
//
// TYPED AS NON-NULL, populated later. `dom` starts as an empty object cast to the interface, which
// carries exactly the same promise the original `let iframe: HTMLIFrameElement;` did: assigned in
// mount() before anything reads it. The move preserves that contract rather than upgrading it —
// making these nullable would force a guard at all ~390 call sites, which is a different change with
// a different risk profile.

export interface Dom {
  markOverlay: HTMLElement;
  fullpageDialog: HTMLDialogElement;
  fullpageFrame: HTMLIFrameElement;
  fullpageCloseBtn: HTMLButtonElement;
  iframe: HTMLIFrameElement;
  singlePreview: HTMLElement;
  categoryOverview: HTMLElement;
  stageView: HTMLElement;
  variantBar: HTMLElement;
  panel: HTMLElement;
  mainEl: HTMLElement;
  previewCaption: HTMLElement;
  sidebarTree: HTMLElement;
  sidebarEl: HTMLElement;
  railBrandEl: HTMLElement;
  searchInput: HTMLInputElement;
  showInternalsCheck: HTMLInputElement;
  hidePackagesCheck: HTMLInputElement;
  hidePackagesLabel: HTMLElement;
  variantSelect: HTMLSelectElement;
  themePickerList: HTMLElement;
  themePickerCurrentName: HTMLElement;
  themePickerSwatch: HTMLElement;
  themePickerReadout: HTMLElement;
  panelToggleBtn: HTMLButtonElement;
  railToggleClusterEl: HTMLElement;
  railToggleLabelEl: HTMLElement;
  panelContent: HTMLElement;
  railStatus: HTMLElement;
  railStatusLabel: HTMLElement;
  dockEl: HTMLElement;
  dockToggleBtn: HTMLButtonElement;
  dockTabBtns: HTMLButtonElement[];
  dockHbsPanel: HTMLElement;
  dockHtmlPanel: HTMLElement;
  dockConsolePanel: HTMLElement;
  hbsBody: HTMLElement;
  htmlBody: HTMLElement;
  consoleEl: HTMLElement;
  diagnosticsEl: HTMLElement;
  dockDiagnosticsPanel: HTMLElement;
  dockCopyBtn: HTMLButtonElement;
  dockFacetsEl: HTMLElement;
  sourceFacetsEl: HTMLElement;
  dockFacetBtns: HTMLButtonElement[];
  dockFacetDataBtn: HTMLButtonElement;
  dockFacetSchemaBtn: HTMLButtonElement;
  dockDataPanel: HTMLElement;
  dockSchemaPanel: HTMLElement;
  dataBody: HTMLElement;
  schemaBody: HTMLElement;
  variantsGalleryEl: HTMLElement;
  viewportToolbar: HTMLElement;
  vpReadout: HTMLElement;
  vpModeLabelEl: HTMLElement;
  vpDiscoBtn: HTMLButtonElement;
  cvdFeMatrix: SVGFEColorMatrixElement | null;
  a11yDetails: HTMLDetailsElement;
  cvdTypeGroup: HTMLElement;
  cvdSeveritySlider: HTMLInputElement;
}

/** The shell's DOM references. Empty until initDom() runs; see the note above. */
export const dom = {} as Dom;

/**
 * Resolve every reference from the mounted shell. Called by mount() immediately after the shell
 * markup is written, and exactly once.
 *
 * Moved verbatim from mount(). The ORDER matters in two places and is preserved: `railStatusLabel`
 * is queried from within `railStatus`, and `fullpageCloseBtn` from within `fullpageDialog`, so each
 * depends on the line above it. The markOverlay block at the end creates its element rather than
 * querying one, and appends it to the stage.
 */
export function initDom(app: HTMLElement): void {
  dom.iframe            = document.getElementById("preview-frame") as HTMLIFrameElement;
  dom.singlePreview     = document.getElementById("single-preview") as HTMLElement;
  dom.categoryOverview  = document.getElementById("category-overview") as HTMLElement;
  dom.mainEl            = app.querySelector(".main") as HTMLElement;
  dom.stageView         = app.querySelector(".stage-view") as HTMLElement;
  dom.variantBar        = app.querySelector(".variant-bar") as HTMLElement;
  dom.panel             = app.querySelector(".panel") as HTMLElement;
  dom.previewCaption    = app.querySelector(".preview-caption") as HTMLElement;
  dom.sidebarTree       = app.querySelector(".sidebar-tree") as HTMLElement;
  dom.sidebarEl         = app.querySelector(".sidebar") as HTMLElement;
  dom.railBrandEl       = app.querySelector(".rail-brand") as HTMLElement;
  dom.searchInput       = app.querySelector(".sidebar-search input") as HTMLInputElement;
  dom.showInternalsCheck = app.querySelector(".show-internals-check") as HTMLInputElement;
  dom.hidePackagesCheck  = app.querySelector(".hide-packages-check") as HTMLInputElement;
  dom.hidePackagesLabel  = app.querySelector(".hide-packages-label") as HTMLElement;
  dom.variantSelect          = app.querySelector(".variant-select") as HTMLSelectElement;
  dom.themePickerList        = app.querySelector(".theme-picker-list") as HTMLElement;
  dom.themePickerCurrentName = app.querySelector(".theme-picker-current-name") as HTMLElement;
  dom.themePickerSwatch      = app.querySelector(".theme-picker-swatch") as HTMLElement;
  dom.themePickerReadout     = app.querySelector(".theme-picker-readout") as HTMLElement;
  dom.panelToggleBtn         = app.querySelector(".panel-toggle-btn") as HTMLButtonElement;
  dom.railToggleClusterEl    = app.querySelector(".rail-toggle-cluster") as HTMLElement;
  dom.railToggleLabelEl      = app.querySelector(".rail-toggle-label") as HTMLElement;
  dom.panelContent           = app.querySelector(".panel-content") as HTMLElement;
  dom.railStatus             = app.querySelector(".rail-status") as HTMLElement;
  dom.railStatusLabel        = dom.railStatus.querySelector(".rail-status-label") as HTMLElement;
  dom.dockEl            = app.querySelector(".dock") as HTMLElement;
  dom.dockToggleBtn     = app.querySelector(".dock-toggle-btn") as HTMLButtonElement;
  dom.dockTabBtns       = Array.from(app.querySelectorAll(".dock-tab")) as HTMLButtonElement[];
  dom.dockHbsPanel      = document.getElementById("dock-panel-hbs") as HTMLElement;
  dom.dockHtmlPanel     = document.getElementById("dock-panel-html") as HTMLElement;
  dom.dockConsolePanel      = document.getElementById("dock-panel-console") as HTMLElement;
  dom.dockDiagnosticsPanel  = document.getElementById("dock-panel-diagnostics") as HTMLElement;
  dom.hbsBody           = dom.dockHbsPanel.querySelector(".source-body") as HTMLElement;
  dom.htmlBody          = dom.dockHtmlPanel.querySelector(".source-body") as HTMLElement;
  dom.consoleEl         = dom.dockConsolePanel.querySelector(".console") as HTMLElement;
  dom.diagnosticsEl     = dom.dockDiagnosticsPanel.querySelector(".diagnostics") as HTMLElement;
  dom.dockCopyBtn       = app.querySelector(".dock-copy-btn") as HTMLButtonElement;
  dom.dockFacetsEl       = app.querySelector(".dock-facets") as HTMLElement;
  dom.dockFacetBtns      = Array.from(app.querySelectorAll(".dock-facet")) as HTMLButtonElement[];
  dom.dockFacetDataBtn   = document.getElementById("dock-facet-data") as HTMLButtonElement;
  dom.dockFacetSchemaBtn = document.getElementById("dock-facet-schema") as HTMLButtonElement;
  dom.sourceFacetsEl     = app.querySelector(".source-facets") as HTMLElement;
  dom.dockDataPanel      = document.getElementById("dock-panel-data") as HTMLElement;
  dom.dockSchemaPanel    = document.getElementById("dock-panel-schema") as HTMLElement;
  dom.dataBody           = dom.dockDataPanel.querySelector(".source-body") as HTMLElement;
  dom.schemaBody         = dom.dockSchemaPanel.querySelector(".source-body") as HTMLElement;
  dom.variantsGalleryEl  = document.getElementById("variants-gallery") as HTMLElement;
  dom.viewportToolbar    = app.querySelector(".rail-vp-cluster") as HTMLElement;
  dom.vpReadout          = app.querySelector(".vp-readout") as HTMLElement;
  dom.vpModeLabelEl      = app.querySelector(".vp-mode-label") as HTMLElement;
  dom.vpDiscoBtn         = app.querySelector(".vp-disco-btn") as HTMLButtonElement;
  dom.cvdFeMatrix        = document.getElementById("cvd-matrix-vals") as SVGFEColorMatrixElement | null;
  dom.a11yDetails        = app.querySelector(".a11y-picker") as HTMLDetailsElement;
  dom.cvdTypeGroup       = app.querySelector(".cvd-type-group") as HTMLElement;
  dom.cvdSeveritySlider  = app.querySelector(".cvd-severity-slider") as HTMLInputElement;
  dom.fullpageDialog     = document.getElementById("fullpage-dialog") as HTMLDialogElement;
  dom.fullpageFrame      = document.getElementById("fullpage-frame")  as HTMLIFrameElement;
  dom.fullpageCloseBtn   = dom.fullpageDialog.querySelector(".fullpage-close") as HTMLButtonElement;

  dom.markOverlay = document.createElement("div");
  dom.markOverlay.className = "pd-mark-overlay";
  dom.markOverlay.setAttribute("aria-hidden", "true");
  dom.markOverlay.innerHTML =
    '<span class="pd-mark pd-mark-tl"></span>' +
    '<span class="pd-mark pd-mark-tr"></span>' +
    '<span class="pd-mark pd-mark-bl"></span>' +
    '<span class="pd-mark pd-mark-br"></span>';
  dom.markOverlay.hidden = true;
  dom.stageView.appendChild(dom.markOverlay);
}
