// Content-fit height for previews that are not full-page: the frame is sized to the document's height
// (pd-height), so a 20px atom does not sit in a 900px frame.
//
// THE LOOP THIS MODULE EXISTS TO PREVENT. A preview's height can DEPEND on the frame's height —
// `height: 200vh`, `min-height: 100vh`, a `%` chain from `html, body { height: 100% }`, a `cqb` length
// inside the document. Then content-fitting is circular: we set the frame to the measured height, the
// content grows with it, the next measurement is larger, and the frame doubles on every observer tick
// until the browser's layout ceiling (Blink clamps at 33554428px, about 13 ticks — the readout freezes
// at a nonsense number instead of settling).
//
// It cannot be closed the way the width axis is. `content-width.ts` measures once at a known width and
// accepts once, which works because a component's width rarely changes by itself. Heights change all the
// time — an accordion opens, a dialog appears — and the frame must follow, so measurements stay live.
//
// So the loop is detected by its signature: the document keeps growing in response to the height WE set.
// Real content grows once and settles; circular content grows again by a similar factor. After two such
// ticks the frame goes back to the last height that held still and is left there until the document is
// replaced or restyled. The document then overflows its frame and scrolls inside it, as any content
// taller than its box does.
//
// Full-page previews never content-fit height at all: the frame fills the stage by CSS.

import { setVpProp } from "./preview-sizing.js";

/** Growth that counts as "the height we set came back at us". Real content settles after one jump; the
 *  loop multiplies by the same factor every tick (2× for `height: 200vh`). */
const GROWTH_FACTOR = 1.5;
/** Consecutive growing ticks before a preview is called circular. One is an accordion; two is a loop. */
const GROWTH_RUN = 2;

/** Per frame: the height this module last wrote, the last height that held still, and how many growing
 *  ticks have followed in a row. */
interface HeightState { last: number; steady: number; run: number }

const state = new WeakMap<HTMLIFrameElement, HeightState>();
/** Frames whose height is circular: parked at their steady height, left alone until reset. */
const circular = new WeakSet<HTMLIFrameElement>();

let report: ((frame: HTMLIFrameElement) => void) | null = null;

/** Whether `measured` continues a run of growth against the heights we imposed — the loop's signature. */
export function isCircularGrowth(previous: HeightState | undefined, measured: number): boolean {
  if (previous === undefined) return false;
  return measured > previous.last * GROWTH_FACTOR && previous.run + 1 >= GROWTH_RUN;
}

/** A full-page preview fills the stage: its height is CSS, never measured (it is circular by
 *  construction — the content derives its height from the frame we would derive from the content). */
function fitsHeight(frame: HTMLIFrameElement): boolean {
  return frame.closest('[data-layout="full"]') === null;
}

/** Apply a pd-height from `frame`'s document. Returns true when the frame's height changed. */
export function acceptContentHeight(frame: HTMLIFrameElement, height: number): boolean {
  if (!fitsHeight(frame) || circular.has(frame)) return false;

  const previous = state.get(frame);
  if (isCircularGrowth(previous, height)) {
    circular.add(frame);
    state.delete(frame);
    frame.dataset.pdHeight = "circular";
    setVpProp(frame, "--vp-h", previous!.steady);
    report?.(frame);
    return true;
  }

  const grew = previous !== undefined && height > previous.last * GROWTH_FACTOR;
  state.set(frame, {
    last: height,
    steady: grew ? previous.steady : height,
    run: grew ? previous.run + 1 : 0,
  });
  setVpProp(frame, "--vp-h", height);
  return true;
}

/** Forget a frame's height history: its document was replaced or restyled, so growth starts over. */
export function resetContentHeight(frame: HTMLIFrameElement): void {
  state.delete(frame);
  circular.delete(frame);
  delete frame.dataset.pdHeight;
}

/** `onCircular` is called once per preview whose height turns out to be circular. The Console lives in
 *  another region, so app/ passes the reporter in, as it does for the rest of the cross-region wiring. */
export function initContentHeight(onCircular: (frame: HTMLIFrameElement) => void): void {
  report = onCircular;
}
