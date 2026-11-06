// The Stage's message protocol with its preview documents.
//
// A preview iframe cannot size itself across the document boundary — iframes are replaced elements,
// so height:auto and fit-content do not content-size them (CONTRIBUTING.md, "The preview is an honest page"). Instead each preview
// document posts its measurements, and this listener applies them:
//   pd-height  -> --vp-h on the sending iframe      (skipped for full-page layouts; see below)
//   pd-width   -> --vp-w on a frame that fits its content (see content-width.ts), and refreshes the
//                 width readout
//   pd-fp      -> full-page dialog: "exit" closes it, "active" reveals its chrome
//
// In stage/ rather than app/: every effect lands on the Stage and every dependency is stage or core.
// It lived inline in mount() only because mount() was where all listeners were registered.
//
// Registered exactly once, from mount(), at the same point in the sequence it always was.

import { dom } from "../core/dom.js";
import { showFullpageChrome } from "./fullpage.js";
import { acceptContentHeightMessage } from "./content-height.js";
import { acceptContentWidth } from "./content-width.js";
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
    const data = e.data as { type?: string; height?: number; width?: number; at?: number; scroll?: number; action?: string } | null;
    if (!data) return;
    if (data.type === "pd-height") {
      // Which frame sent it, which frames content-fit their height, and what stops a centered preview
      // whose own height depends on the frame's from ballooning: the shared fitter (content-height.ts,
      // over @pattern-dump/contracts). Full-page layout is viewport-inert in height: the iframe fills the
      // stage and a taller page scrolls INSIDE it. documentElement.scrollHeight stays the measurement
      // (glyph-ink + margin-collapse correct).
      acceptContentHeightMessage(e, document.querySelectorAll("iframe"));
    } else if (data.type === "pd-width" && typeof data.width === "number" && typeof data.at === "number") {
      const { width, at } = data;
      const scroll = typeof data.scroll === "number" ? data.scroll : at;
      document.querySelectorAll("iframe").forEach((f) => {
        const frame = f as HTMLIFrameElement;
        if (frame.contentWindow !== e.source) return;
        if (acceptContentWidth(frame, width, at, scroll) && frame === dom.iframe) {
          requestAnimationFrame(updateReadout);
        }
      });
    } else if (data.type === "pd-fp") {
      if (data.action === "exit")   dom.fullpageDialog.close();
      else if (data.action === "active") showFullpageChrome();
    }
  });
}
