// Stage splitters — the draggable region dividers.
//
// Restores persisted track sizes, probes the CSS floors, and runs the pointer drags for every
// [data-resize] handle. Self-contained: reads `dom` and `store` and nothing else, which is why it
// is the first region module out of main.ts.
//
// Sizes are computed in px during a drag and persisted as vw/vh, so a restored layout survives a
// window resize. The drag uses REAL pointer capture — a synthetic PointerEvent carries no active
// pointer id, so setPointerCapture throws NotFoundError and the handler aborts before it snapshots
// anything. That is why the E2E drags use page.mouse rather than dispatched events.

import { dom } from "../core/dom.js";
import { store } from "../core/store.js";

export function initSplitters(): void {
  // Re-apply persisted track sizes from store (localStorage via store.hydrate).
  const dims = store.local.dims;
  if (dims.sidebarW) dom.mainEl.style.setProperty("--pd-sidebar-w", dims.sidebarW);
  if (dims.panelW)   dom.mainEl.style.setProperty("--pd-panel-w",   dims.panelW);
  if (dims.dockH)    dom.mainEl.style.setProperty("--pd-dock-h",    dims.dockH);

  // Clamp-on-load: read back what CSS actually rendered (floors/ceilings apply) and
  // re-persist if any stored value was out of range. Runs in rAF so layout has settled.
  requestAnimationFrame(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const renderedSidebar = dom.sidebarEl.getBoundingClientRect().width;
    const renderedPanel   = ("panelOpen" in dom.mainEl.dataset && !dom.panel.hidden)
                            ? dom.panel.getBoundingClientRect().width : null;
    const renderedDock    = !dom.dockEl.hidden ? dom.dockEl.getBoundingClientRect().height : null;

    function pxToVw(px: number): string { return `${((px / vw) * 100).toFixed(2)}vw`; }
    function pxToVh(px: number): string { return `${((px / vh) * 100).toFixed(2)}vh`; }

    const cur = store.local.dims;
    const storedSidebarPx = cur.sidebarW ? parseFloat(cur.sidebarW) / 100 * vw : null;
    const storedPanelPx   = cur.panelW   ? parseFloat(cur.panelW)   / 100 * vw : null;
    const storedDockPx    = cur.dockH    ? parseFloat(cur.dockH)    / 100 * vh : null;

    const EPS = 2; // px tolerance for floating-point drift
    let next: typeof cur = cur;
    let changed = false;

    if (storedSidebarPx !== null && Math.abs(storedSidebarPx - renderedSidebar) > EPS) {
      next = { ...next, sidebarW: pxToVw(renderedSidebar) };
      dom.mainEl.style.setProperty("--pd-sidebar-w", next.sidebarW);
      changed = true;
    }
    if (renderedPanel !== null && storedPanelPx !== null && Math.abs(storedPanelPx - renderedPanel) > EPS) {
      next = { ...next, panelW: pxToVw(renderedPanel) };
      dom.mainEl.style.setProperty("--pd-panel-w", next.panelW);
      changed = true;
    }
    if (renderedDock !== null && storedDockPx !== null && Math.abs(storedDockPx - renderedDock) > EPS) {
      next = { ...next, dockH: pxToVh(renderedDock) };
      dom.mainEl.style.setProperty("--pd-dock-h", next.dockH);
      changed = true;
    }
    if (changed) store.setLocal({ dims: next });
  });

  // Probe content-driven floor values using the same CSS expressions as _main.scss clamp() mins.
  // Appending to a context element ensures ch/rem/custom-props resolve from the right font.
  function probeWidth(cssExpr: string, contextEl: Element): number {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:${cssExpr}`;
    contextEl.appendChild(el);
    const px = Math.round(el.getBoundingClientRect().width);
    el.remove();
    return px;
  }
  const STAGE_MIN_PX   = 320; // matches --pd-stage-min in _main.scss
  const DOCK_MIN_PX    = 80;
  const panelFloorPx   = 320; // matches --pd-stage-min; content wrapping is acceptable
  const sidebarFloorPx = probeWidth("var(--pd-rail-min)", dom.mainEl);

  // Wire each [data-resize] handle.
  dom.mainEl.querySelectorAll("[data-resize]").forEach((el) => {
    const handle = el as HTMLElement;
    const key = handle.dataset.resize!; // "sidebar-w" | "panel-w" | "dock-h"
    handle.addEventListener("pointerdown", (e) => {
      const pe = e as PointerEvent;
      pe.preventDefault();
      handle.setPointerCapture(pe.pointerId);
      dom.mainEl.dataset.noTransition = "";
      // Disable pointer events on all iframes so they don't absorb pointerup/pointermove
      // during a drag (prevents cross-document event loss in both real browsers and Playwright).
      document.querySelectorAll<HTMLElement>("iframe").forEach(f => { f.style.pointerEvents = "none"; });

      const startX = pe.clientX;
      const startY = pe.clientY;

      // Snapshot the tracked dimension in px.
      let startPx: number;
      if (key === "sidebar-w") startPx = dom.sidebarEl.getBoundingClientRect().width;
      else if (key === "panel-w") startPx = dom.panel.getBoundingClientRect().width;
      else startPx = dom.dockEl.getBoundingClientRect().height;

      function computeVal(ce: PointerEvent): string {
        let newPx: number;
        if (key === "sidebar-w") {
          newPx = startPx + (ce.clientX - startX);
          // Ceiling: sidebar stops before panel readability floor (or stage min if panel closed).
          const reservedForPanel = ("panelOpen" in dom.mainEl.dataset) ? panelFloorPx : 0;
          newPx = Math.min(newPx, window.innerWidth - reservedForPanel - STAGE_MIN_PX);
          newPx = Math.max(newPx, sidebarFloorPx);
        } else if (key === "panel-w") {
          // Panel is on the right: drag left = wider.
          newPx = startPx - (ce.clientX - startX);
          newPx = Math.min(newPx, window.innerWidth - sidebarFloorPx - STAGE_MIN_PX);
          newPx = Math.max(newPx, panelFloorPx);
        } else {
          // Dock is at the bottom: drag up = taller.
          newPx = startPx - (ce.clientY - startY);
          newPx = Math.max(newPx, DOCK_MIN_PX);
          newPx = Math.min(newPx, window.innerHeight * 0.80); // leaves 20vh for stage
        }
        return `${Math.round(newPx)}px`;
      }

      const prop = `--pd-${key}`;

      function onMove(me: Event): void {
        dom.mainEl.style.setProperty(prop, computeVal(me as PointerEvent));
      }

      function endDrag(): void {
        delete dom.mainEl.dataset.noTransition;
        document.querySelectorAll<HTMLElement>("iframe").forEach(f => { f.style.pointerEvents = ""; });
        // Read the actual rendered dimension — CSS clamp() is the source of truth for what's stored.
        // This ensures persisted vw/vh values always reflect the clamped layout, not raw pointer math.
        const actualPx = key === "sidebar-w" ? dom.sidebarEl.getBoundingClientRect().width
                       : key === "panel-w"   ? dom.panel.getBoundingClientRect().width
                       :                       dom.dockEl.getBoundingClientRect().height;
        const val = (key === "dock-h")
          ? `${((actualPx / window.innerHeight) * 100).toFixed(2)}vh`
          : `${((actualPx / window.innerWidth)  * 100).toFixed(2)}vw`;
        dom.mainEl.style.setProperty(prop, val);
        const cur = store.local.dims;
        if (key === "sidebar-w") store.setLocal({ dims: { ...cur, sidebarW: val } });
        else if (key === "panel-w") store.setLocal({ dims: { ...cur, panelW:   val } });
        else                        store.setLocal({ dims: { ...cur, dockH:    val } });
        document.removeEventListener("pointermove", onMove, true);
        document.removeEventListener("pointerup", endDrag, true);
        document.removeEventListener("pointercancel", endDrag, true);
      }

      // Use document-level capture listeners so events are caught even when the cursor
      // is over an iframe (Playwright CDP can route events into iframe documents).
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", endDrag, true);
      document.addEventListener("pointercancel", endDrag, true);
    });
  });
}
