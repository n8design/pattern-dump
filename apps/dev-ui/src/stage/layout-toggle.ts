// The "Full height" toggle: flips how the pattern on stage is previewed, for this view only.
//
// The pattern's stored mode (session.current.layout) is resolved by the server: category default,
// folder index.md, the schema's x-pd-preview, the component's .md. The toggle overrides it in the URL
// (`?layout=full|centered`), like `?vp=`: URL-canonical, validated against the known modes, written only
// while it differs from the stored mode, and dropped when another pattern is shown (links carry only
// `?vp=`). Nothing is stored.
//
// It changes the frame's HEIGHT, not the document. The preview document is built for the stored mode,
// and only a centered one measures its content width (pd-width). So "full" fills the stage for any
// pattern, while turning a full pattern off gives it its content height at the full width: the width
// is fitted only when the document itself is centered (content-width.ts).

import type { LayoutMode } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { store } from "../core/store.js";
import { svgIcon } from "../icons/index.js";
import { applyViewport } from "./viewport.js";

/** The mode the stage shows: the URL's override, or the pattern's stored mode. */
export function effectiveLayout(): LayoutMode | null {
  const stored = session.current?.layout ?? null;
  if (stored === null) return null;
  return store.url.layout ?? stored;
}

/** `layout=<mode>` while the view overrides the pattern's stored mode, else "". For same-pattern URLs. */
function layoutParam(): string {
  const l = store.url.layout;
  return l !== null && session.current && l !== session.current.layout ? `layout=${l}` : "";
}

/** A query string (`""` or `?vp=…`) with the layout override added. Use it only for URLs that stay on
 *  the same pattern (another variant, the variants gallery); other links drop the override. */
export function withLayoutParam(query: string): string {
  const p = layoutParam();
  if (!p) return query;
  return query ? `${query}&${p}` : `?${p}`;
}

function writeUrl(): void {
  const u = new URL(window.location.href);
  const p = layoutParam();
  if (p) u.searchParams.set("layout", store.url.layout!);
  else u.searchParams.delete("layout");
  history.replaceState(history.state, "", u.pathname + (u.search || "") + u.hash);
}

/**
 * Show the effective mode: on the stage (`data-layout`), on the toggle, and in the URL. Called when a
 * pattern or its gallery is shown (before its documents load), and by the toggle. An override equal to
 * the stored mode, or one with no pattern on stage, falls back to the stored mode (the store's single
 * reconciliation rule).
 */
export function applyLayout(): boolean {
  const stored = session.current?.layout ?? null;
  if (stored === null || store.url.layout === stored) {
    if (store.url.layout !== null) store.setUrl({ layout: null });
  }
  writeUrl();

  const layout = effectiveLayout();
  if (layout === null) {
    dom.stageView.removeAttribute("data-layout");
    dom.layoutToggleBtn.hidden = true;
    return false;
  }
  const changed = dom.stageView.dataset.layout !== layout;
  dom.stageView.dataset.layout = layout;
  const on = layout === "full";
  dom.layoutToggleBtn.hidden = false;
  dom.layoutToggleBtn.setAttribute("aria-pressed", String(on));
  dom.layoutToggleBtn.innerHTML = svgIcon(on ? "vp-height-fill" : "vp-height");
  return changed;
}

/** Load the stage's documents again, unchanged, so they report their height (and a centered one its
 *  width) under the new mode: a document posts pd-height when it loads and when its body resizes, and
 *  flipping the frame's mode resizes neither. The load handlers start the height and width over. */
function reloadStage(): void {
  dom.iframe.style.removeProperty("--vp-h");
  applyViewport();
  if (session.stageMode === "variants") {
    for (const f of dom.variantsGalleryEl.querySelectorAll("iframe")) {
      f.style.removeProperty("--vp-h");
      // eslint-disable-next-line no-self-assign -- re-setting reloads the same document (see above)
      if (f.srcdoc) f.srcdoc = f.srcdoc; else if (f.src) f.src = f.src;
    }
  } else if (dom.iframe.srcdoc) {
    // eslint-disable-next-line no-self-assign -- re-setting srcdoc reloads the same document (see above)
    dom.iframe.srcdoc = dom.iframe.srcdoc;
  }
}

/** Hide the toggle: nothing on stage that it applies to (a folder overview, a message, home). */
export function hideLayoutToggle(): void {
  dom.layoutToggleBtn.hidden = true;
}

export function initLayoutToggle(): void {
  dom.layoutToggleBtn.addEventListener("click", () => {
    const current = effectiveLayout();
    if (current === null) return;
    store.setUrl({ layout: current === "full" ? "centered" : "full" });
    if (applyLayout()) reloadStage();
  });
}
