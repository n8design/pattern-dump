// The viewport simulator — the stage's size controls.
//
// Owns the preset/fit/content modes, the live width readout, the ruler marks, and the "disco" sweep.
// Viewport is URL-canonical: store.url.viewport is the truth and nothing here reads sessionStorage.
//
// `initViewport` takes the fullscreen edge as a PARAMETER rather than calling openFullpage — see its
// docblock. That keeps stage/fullpage -> stage/viewport one-directional instead of a cycle the
// region lint rule could not see, since both modules live in this region.
//
// The disco counters are module-private: only startDisco/stopDisco touch them, so they do not
// belong in session.ts, which is for state shared ACROSS regions.

import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { store } from "../core/store.js";
import { setupRadiogroupKeyboard } from "../core/radiogroup.js";
import { svgIcon } from "../icons/index.js";
import { measureContentWidth, stopMeasuring } from "./content-width.js";

const PRESETS = {
  mobile:  { w: 375,  h: 667  },
  tablet:  { w: 768,  h: 1024 },
  desktop: { w: 1280, h: 800  },
} as const;
type PresetName = keyof typeof PRESETS;

// vpMode, vpPreset, vpModeBeforeDisco removed — viewport is URL-canonical via store.url.viewport.
// vpOrientation removed — height is not a controlled axis; orientation was dead code.
let vpDisco = false;
let vpDiscoRaf = 0;
let vpDiscoX = 320;
let vpDiscoDir = 1;

export function updateVpModeLabel(): void {
  if (dom.vpDiscoBtn.getAttribute("aria-pressed") === "true") {
    dom.vpModeLabelEl.textContent = "Disco";
    return;
  }
  const active = dom.viewportToolbar.querySelector<HTMLElement>('[data-vp][aria-checked="true"]');
  dom.vpModeLabelEl.textContent = active?.getAttribute("aria-label") ?? "";
}

export function updateReadout(): void {
  dom.iframe.title = session.current
    ? session.currentVariant ? `Preview: ${session.current.id}~${session.currentVariant}` : `Preview: ${session.current.id}`
    : "Component preview";
  try {
    const cw = dom.iframe.contentWindow;
    if (!cw) { dom.vpReadout.textContent = "— × —"; return; }
    const w = cw.innerWidth;
    const h = cw.innerHeight;
    dom.vpReadout.textContent = `${w} × ${h}`;
    dom.vpReadout.setAttribute("aria-label", `Viewport ${w} by ${h} pixels`);
  } catch {
    dom.vpReadout.textContent = "— × —";
  }
  syncMarks();
}

export function syncMarks(): void {
  if (dom.singlePreview.hidden) { dom.markOverlay.hidden = true; return; }
  const fr = dom.iframe.getBoundingClientRect();
  if (fr.width < 1 || fr.height < 1) { dom.markOverlay.hidden = true; return; }
  const sr = dom.stageView.getBoundingClientRect();
  const EPSILON = 2; // sub-pixel / border rounding tolerance
  // Show only when the frame is smaller than the stage on BOTH axes, and never in fit mode: a
  // content-fitted frame there is the component's own size, not a simulated viewport.
  // Hides for fit, fullscreen, and any preset that clamps to stage width/height.
  if (dom.iframe.classList.contains("vp-fit") || fr.width >= sr.width - EPSILON || fr.height >= sr.height - EPSILON) {
    dom.markOverlay.hidden = true;
    return;
  }
  dom.markOverlay.style.left   = `${fr.left - sr.left}px`;
  dom.markOverlay.style.top    = `${fr.top  - sr.top}px`;
  dom.markOverlay.style.width  = `${fr.width}px`;
  dom.markOverlay.style.height = `${fr.height}px`;
  dom.markOverlay.hidden = false;
}

// CSS :focus/:focus-within don't cross the iframe document boundary, so focus state is
// tracked via JS: focusin on the srcdoc document adds the class; focusin on the parent
// document (any shell element gaining focus) removes it. The class drives the outline.
export function syncFrameFocusListeners(): void {
  try {
    const doc = dom.iframe.contentDocument;
    if (!doc) return;
    doc.addEventListener("focusin", () => dom.iframe.classList.add("frame-focused"), { capture: true });
  } catch {
    // fail-open: cross-origin or no document
  }
}

// Returns ?vp=X (non-fit) or "" (fit) for including in pushState URLs.
export function currentVpParam(): string {
  const vp = store.url.viewport;
  return (vp !== "fit" && vp !== "fullscreen") ? `?vp=${encodeURIComponent(vp)}` : "";
}

export function applyViewport(): void {
  const vp = store.url.viewport;
  // "fullscreen" is handled by the fullpage dialog; treat it like fit for iframe sizing.
  if (vp === "fit" || vp === "fullscreen") {
    dom.iframe.style.removeProperty("--vp-w");
    dom.iframe.classList.remove("vp-sized");
    dom.iframe.classList.remove("vp-content");
    dom.iframe.classList.add("vp-fit");
    // A centered component's frame is sized to its content and centred (content-width.ts).
    measureContentWidth(dom.iframe);
  } else if (vp === "content") {
    dom.iframe.classList.remove("vp-sized");
    dom.iframe.classList.remove("vp-fit");
    dom.iframe.classList.add("vp-content");
    measureContentWidth(dom.iframe);
  } else {
    stopMeasuring(dom.iframe);
    const p = PRESETS[vp as PresetName];
    dom.iframe.style.setProperty("--vp-w", `${p.w}px`);
    dom.iframe.classList.add("vp-sized");
    dom.iframe.classList.remove("vp-content");
    dom.iframe.classList.remove("vp-fit");
  }

  // Update preset button states: aria-checked + fill/regular icon swap.
  dom.viewportToolbar.querySelectorAll<HTMLButtonElement>("[data-vp]").forEach(btn => {
    const key = btn.dataset.vp!;
    const active = key === vp;
    btn.setAttribute("aria-checked", String(active));
    btn.innerHTML = active ? svgIcon(`vp-${key}-fill` as import("../icons/index.js").IconName)
                           : svgIcon(`vp-${key}` as import("../icons/index.js").IconName);
  });

  // Roving tabindex: checked radio is the single tab stop.
  // When vp === "fullscreen" nothing is checked → first radio stays reachable as entry point.
  const radios = [...dom.viewportToolbar.querySelectorAll<HTMLButtonElement>("[role='radio']")];
  const checkedIdx = radios.findIndex(b => b.dataset.vp === vp && vp !== "fullscreen");
  radios.forEach((b, i) => { b.tabIndex = (checkedIdx === -1 ? i === 0 : i === checkedIdx) ? 0 : -1; });

  requestAnimationFrame(updateReadout);
  updateVpModeLabel();
  // No sessionStorage writes — viewport is URL-canonical; pd-vp-mode/pd-vp-preset removed.
}

/**
 * Is the disco sweep currently running?
 *
 * Exported so callers outside this module can keep guarding `if (isDiscoRunning()) stopDisco()`
 * without the counters leaving it. The guard is NOT redundant: stopDisco ends with
 * `delete dom.mainEl.dataset.noTransition`, so calling it unconditionally could clear a flag another
 * code path set. Making stopDisco idempotent instead would be a behaviour change, not a move.
 */
export function isDiscoRunning(): boolean {
  return vpDisco;
}

export function stopDisco(): void {
  vpDisco = false;
  cancelAnimationFrame(vpDiscoRaf);
  dom.viewportToolbar.removeAttribute("data-disco-active"); // re-enable the active-mode accent (mutual exclusion)
  dom.vpDiscoBtn.setAttribute("aria-pressed", "false");
  dom.vpDiscoBtn.innerHTML = svgIcon("vp-disco");
  delete dom.mainEl.dataset.noTransition;
  // store.url.viewport is unchanged during disco; applyViewport restores from it.
  applyViewport();
}

export function startDisco(): void {
  if (vpDisco) return;
  // No need to save vpModeBeforeDisco — store.url.viewport persists through disco unchanged.
  vpDisco = true;
  stopMeasuring(dom.iframe);
  dom.viewportToolbar.setAttribute("data-disco-active", ""); // suppress the active-mode accent → disco owns the one red
  dom.vpDiscoBtn.setAttribute("aria-pressed", "true");
  dom.vpDiscoBtn.innerHTML = svgIcon("vp-disco-fill");
  dom.mainEl.dataset.noTransition = "";
  dom.iframe.classList.add("vp-sized");
  vpDiscoX = Math.max(320, Math.round(dom.iframe.getBoundingClientRect().width) || 320);
  vpDiscoDir = 1;

  function tick(): void {
    if (!vpDisco) return;
    const stageW = dom.stageView.clientWidth;
    vpDiscoX += vpDiscoDir * 4;
    if (vpDiscoX >= stageW) { vpDiscoX = stageW; vpDiscoDir = -1; }
    if (vpDiscoX <= 320)    { vpDiscoX = 320;    vpDiscoDir =  1; }
    dom.iframe.style.setProperty("--vp-w", `${vpDiscoX}px`);
    updateReadout();
    vpDiscoRaf = requestAnimationFrame(tick);
  }
  vpDiscoRaf = requestAnimationFrame(tick);
}

/**
 * Wire the viewport toolbar.
 *
 * `onFullscreen` is injected rather than called directly, and that is structural, not ceremony:
 * "fullscreen" is a viewport MODE whose rendering is the full-page dialog, so the toolbar needs to
 * open it — while the dialog, on close, restores the viewport. Calling each other directly makes
 * viewport and fullpage mutually dependent. Both live in stage/, so the region lint rule would not
 * catch it; the cycle would simply exist. Injecting this one edge keeps the dependency
 * one-directional (fullpage -> viewport) once both are their own modules.
 */
export function initViewport(onFullscreen: () => void): void {
  // Viewport is URL-canonical — store.url.viewport is already set by hydrate (parseUrlState).
  // No sessionStorage reads; pd-vp-mode/pd-vp-preset removed.
  applyViewport();

  // Preset + fit button clicks — use replaceState (viewport is preference, not navigation).
  dom.viewportToolbar.querySelectorAll<HTMLButtonElement>("[data-vp]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (vpDisco) stopDisco();
      const key = btn.dataset.vp!;
      if (key === "fullscreen") { onFullscreen(); return; }
      store.setUrl({ viewport: key as import("../core/store.js").VpMode });
      const u = new URL(window.location.href);
      if (key === "fit") u.searchParams.delete("vp");
      else u.searchParams.set("vp", key);
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
      applyViewport();
    });
  });

  // Disco toggle.
  dom.vpDiscoBtn.addEventListener("click", () => {
    if (vpDisco) stopDisco();
    else startDisco();
    updateVpModeLabel();
  });

  // Row-2 hover/focus mode-name label — dual-tracked; reverts only when both pointer+focus leave.
  let vpPointerInside = false;
  let vpFocusInside = false;
  const showVpLabel = (e: Event): void => {
    const btn = (e.target as Element).closest<HTMLElement>(".rail-vp-btn");
    if (!btn) return;
    if (btn.dataset.labelOff !== undefined) {
      const on = btn.getAttribute("aria-pressed") === "true";
      dom.vpModeLabelEl.textContent = on ? (btn.dataset.labelOn ?? "") : (btn.dataset.labelOff ?? "");
    } else {
      dom.vpModeLabelEl.textContent = btn.getAttribute("aria-label") ?? "";
    }
  };
  const tryRevertVpLabel = (): void => {
    if (!vpPointerInside && !vpFocusInside) updateVpModeLabel();
  };
  dom.viewportToolbar.addEventListener("pointerenter", (e) => { vpPointerInside = true; showVpLabel(e); }, true);
  dom.viewportToolbar.addEventListener("pointerleave", () => { vpPointerInside = false; tryRevertVpLabel(); });
  dom.viewportToolbar.addEventListener("focusin", (e) => { vpFocusInside = true; showVpLabel(e); });
  dom.viewportToolbar.addEventListener("focusout", (e) => {
    if (!e.relatedTarget || !dom.viewportToolbar.contains(e.relatedTarget as Node)) {
      vpFocusInside = false;
      tryRevertVpLabel();
    }
  });

  setupRadiogroupKeyboard(dom.viewportToolbar.querySelector<HTMLElement>("[role='radiogroup']")!);

  // Live readout + mark sync via ResizeObserver.
  // Observe both the iframe (size changes from pd-width/pd-height) and the stage-view
  // (position shifts when stage width changes — preset frames have fixed width so only
  // their center-point moves when the sidebar/panel is dragged).
  const iframeObserver = new ResizeObserver(() => requestAnimationFrame(updateReadout));
  iframeObserver.observe(dom.iframe);
  iframeObserver.observe(dom.stageView);
  dom.iframe.addEventListener("load", () => { measureContentWidth(dom.iframe); updateReadout(); syncFrameFocusListeners(); });

  // Leave path: any shell element gaining focus means the iframe lost it.
  // focusin doesn't cross iframe boundaries so this only fires for parent-doc focus.
  document.addEventListener("focusin", () => dom.iframe.classList.remove("frame-focused"), { capture: true });
}

// Publish the device-pixel ratio as --dpr on :root so CSS round() can snap resolved track sizes to
// whole DEVICE pixels (calc(1px / var(--dpr))), keeping hairlines/baselines crisp at any dpr. A
// resolution media query re-arms on each change (monitor move / browser zoom) — the media string is
// dpr-specific, so we rebuild it with the new dpr each time. No track recompute needed: round()
// re-resolves live off --dpr.
export function initDprTracking(): void {
  const setDpr = (): void => {
    document.documentElement.style.setProperty("--dpr", String(window.devicePixelRatio));
  };
  setDpr();
  const arm = (): void => {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener("change", () => { setDpr(); arm(); }, { once: true });
  };
  arm();
}
