// The Stage's message protocol with its preview documents.
//
// A preview iframe cannot size itself across the document boundary — iframes are replaced elements,
// so height:auto and fit-content do not content-size them (CONTRIBUTING.md, "The preview is an honest page"). Instead each preview
// document posts its measurements, and this listener applies them:
//   pd-height  -> --vp-h on the sending iframe      (skipped for full-page layouts; see below)
//   pd-width   -> --vp-w, only in "content" viewport mode, and refreshes the width readout
//   pd-fp      -> full-page dialog: "exit" closes it, "active" reveals its chrome
//
// In stage/ rather than app/: every effect lands on the Stage and every dependency is stage or core.
// It lived inline in mount() only because mount() was where all listeners were registered.
//
// Registered exactly once, from mount(), at the same point in the sequence it always was.

import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { store } from "../core/store.js";
import { showFullpageChrome } from "./fullpage.js";
import { setVpProp } from "./preview-sizing.js";
import { updateReadout } from "./viewport.js";

export function listenForPreviewMessages(): void {
  // Height-fit and content-fit: receive scrollHeight/scrollWidth from preview documents.
  // Identify the sender by e.source (the iframe's contentWindow) — no pathname correlation
  // needed now that iframes are driven by srcdoc rather than a URL.
  // Writes --vp-h / --vp-w (custom properties) so the CSS var() picks them up without
  // fighting applyViewport.
  // Bounds for content mode are enforced by CSS max-width/max-height on .vp-content
  // (see _stage.scss) — the CSS clamp is live on every paint so it handles stage resizes.
  window.addEventListener("message", (e: MessageEvent<unknown>) => {
    const data = e.data as { type?: string; height?: number; width?: number; action?: string } | null;
    if (!data) return;
    if (data.type === "pd-height" && typeof data.height === "number") {
      const height = data.height;
      document.querySelectorAll("iframe").forEach((f) => {
        if ((f as HTMLIFrameElement).contentWindow === e.source) {
          const el = f as HTMLIFrameElement;
          // Full-page layout is viewport-inert in HEIGHT — exactly as it already is in width. The
          // iframe fills the stage and a taller page scrolls INSIDE it; it must not grow the
          // viewport. Content-fitting height there is circular by construction with viewport-relative
          // content (height:100vh / min-height:100% / a flex column) — the content derives its
          // height FROM the iframe we would derive from the content — so the iframe balloons
          // unbounded. Only centered/fit layouts content-fit height (a 20px atom must not sit in a
          // 900px frame). documentElement.scrollHeight stays the measurement (glyph-ink + margin-
          // collapse correct); the body's UA margin only ever compounded because height fed back.
          if (el.closest('[data-layout="full"]')) return;
          // Guarded write: a no-op --vp-h write still forces a recalc that re-triggers the srcdoc
          // ResizeObserver → feedback loop. The width path shares setVpProp so the two cannot drift.
          setVpProp(el, "--vp-h", height);
        }
      });
    } else if (data.type === "pd-width" && typeof data.width === "number") {
      session.lastPdWidth = data.width;
      if (store.url.viewport === "content") {
        const width = data.width;
        document.querySelectorAll("iframe").forEach((f) => {
          if ((f as HTMLIFrameElement).contentWindow === e.source) {
            setVpProp(f as HTMLIFrameElement, "--vp-w", width);
          }
        });
        requestAnimationFrame(updateReadout);
      }
    } else if (data.type === "pd-fp") {
      if (data.action === "exit")   dom.fullpageDialog.close();
      else if (data.action === "active") showFullpageChrome();
    }
  });
}
