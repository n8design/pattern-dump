// Content-fit height for the Stage's previews that are not full-page: the frame is sized to the
// document's height (pd-height), so a 20px atom does not sit in a 900px frame.
//
// The fitting rule and its loop guard (a preview whose height depends on the frame's own height) live in
// @pattern-dump/contracts (iframe-fit.ts), shared with storefront pages. This module is the Stage's
// adapter: how a height is written (the --vp-h custom property), which frames fit (not full-page ones),
// and what a circular preview looks like here (data-pd-height="circular", a Console line).
//
// Full-page previews never content-fit height at all: the frame fills the stage by CSS.

import { createHeightFitter } from "@pattern-dump/contracts";
import { setVpProp } from "./preview-sizing.js";

export { isCircularGrowth } from "@pattern-dump/contracts";

let report: ((frame: HTMLIFrameElement) => void) | null = null;

const fitter = createHeightFitter({
  write: (frame, height) => setVpProp(frame, "--vp-h", height),
  // A full-page preview fills the stage: its height is CSS, never measured (it is circular by
  // construction — the content derives its height from the frame we would derive from the content).
  fits: frame => frame.closest('[data-layout="full"]') === null,
  onCircular: frame => {
    frame.dataset.pdHeight = "circular";
    report?.(frame);
  },
  onReset: frame => { delete frame.dataset.pdHeight; },
});

/** Apply a pd-height from `frame`'s document. Returns true when the frame's height changed. */
export function acceptContentHeight(frame: HTMLIFrameElement, height: number): boolean {
  return fitter.accept(frame, height);
}

/** Apply a pd-height message to whichever of `frames` sent it. Ignores anything else. */
export function acceptContentHeightMessage(event: MessageEvent<unknown>, frames: Iterable<HTMLIFrameElement>): void {
  const match = fitter.fromMessage(event, frames);
  if (match) fitter.accept(match.frame, match.height);
}

/** Forget a frame's height history: its document was replaced or restyled, so growth starts over. */
export function resetContentHeight(frame: HTMLIFrameElement): void {
  fitter.reset(frame);
}

/** `onCircular` is called once per preview whose height turns out to be circular. The Console lives in
 *  another region, so app/ passes the reporter in, as it does for the rest of the cross-region wiring. */
export function initContentHeight(onCircular: (frame: HTMLIFrameElement) => void): void {
  report = onCircular;
}
