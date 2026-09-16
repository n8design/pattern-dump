// The full-page preview dialog — the rendering of the "fullscreen" viewport mode.
//
// Depends on ./viewport.js and NOT the reverse: initViewport takes the fullscreen edge as a
// parameter precisely so this direction stays one-way. Both modules live in stage/, so the region
// lint rule cannot see a cycle between them — it had to be designed out rather than caught.
//
// State here is module-private, deliberately not in session.ts. `fullpageUnsubscribe` holds a live
// store.subscribe() disposer: the only thing that releases it is the close handler in initFullpage,
// so keeping it adjacent to that handler is what stops a subscription leak.

import { previewUrl } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { store } from "../core/store.js";
import { withForwarder } from "./fullpage-forwarder.js";
import { applyViewport } from "./viewport.js";

let fpIdleTimer: ReturnType<typeof setTimeout> | null = null;
// Unsubscribe handle for the store live-sync subscription (active while dialog is open).
let fullpageUnsubscribe: (() => void) | null = null;


export function showFullpageChrome(): void {
  dom.fullpageDialog.classList.add("fp-chrome-visible");
  if (fpIdleTimer !== null) clearTimeout(fpIdleTimer);
  fpIdleTimer = setTimeout(() => {
    dom.fullpageDialog.classList.remove("fp-chrome-visible");
    fpIdleTimer = null;
  }, 2000);
}

// Fetch the current component's preview and set it as the fullpage frame's srcdoc.
// withForwarder is applied on EVERY update so the postMessage ESC/activity bridge
// re-establishes after each live-sync srcdoc replacement.
export async function refreshFullpageContent(): Promise<void> {
  if (!session.current) return;
  try {
    const doc = await fetch(previewUrl(session.current.id, session.currentVariant ?? undefined, store.local.theme || undefined)).then(r => r.text());
    dom.fullpageFrame.srcdoc = withForwarder(doc);
  } catch { /* ignore — stale frame better than crash */ }
}

export async function openFullpage(): Promise<void> {
  if (!session.current) return;

  // Update URL: ?vp=fullscreen.
  store.setUrl({ viewport: "fullscreen" });
  const u = new URL(window.location.href);
  u.searchParams.set("vp", "fullscreen");
  history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  applyViewport();

  // Fetch content (no DOM clone — srcdoc from /preview/:id).
  await refreshFullpageContent();
  dom.fullpageDialog.showModal();

  // Subscribe for live-sync: any store change while dialog is open re-fetches.
  if (fullpageUnsubscribe) fullpageUnsubscribe();
  fullpageUnsubscribe = store.subscribe(() => {
    if (dom.fullpageDialog.open) void refreshFullpageContent();
  });
}

export function initFullpage(): void {
  dom.fullpageCloseBtn.addEventListener("click", () => dom.fullpageDialog.close());
  dom.fullpageDialog.addEventListener("close", () => {
    dom.fullpageFrame.srcdoc = "";
    if (fpIdleTimer !== null) { clearTimeout(fpIdleTimer); fpIdleTimer = null; }
    dom.fullpageDialog.classList.remove("fp-chrome-visible");
    // Tear down live-sync subscription.
    if (fullpageUnsubscribe) { fullpageUnsubscribe(); fullpageUnsubscribe = null; }
    // Restore viewport to fit when dialog closes.
    if (store.url.viewport === "fullscreen") {
      store.setUrl({ viewport: "fit" });
      const u = new URL(window.location.href);
      u.searchParams.delete("vp");
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
      applyViewport();
    }
  });
  dom.viewportToolbar.querySelector<HTMLButtonElement>(".fullpage-btn")!
    .addEventListener("click", () => { void openFullpage(); });
}
