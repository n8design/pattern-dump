// Content-fit height for preview iframes — the one implementation, shared by every page that embeds
// a preview: the workbench Stage, and (inlined) storefront pages.
//
// A preview cannot size its frame across the document boundary (iframes are replaced elements), so the
// preview document posts `{ type: "pd-height", height }` with its documentElement.scrollHeight, and the
// embedding page sets the frame's height from it. scrollHeight never drops below the frame's own height,
// so a frame must start small to be measured; that is the embedding page's job, not this module's.
//
// THE LOOP THIS MODULE EXISTS TO PREVENT. A preview's height can DEPEND on the frame's height —
// `height: 200vh`, `min-height: 100vh`, a `%` chain from `html, body { height: 100% }`, a `cqb` length
// inside the document. Then content-fitting is circular: we set the frame to the measured height, the
// content grows with it, the next measurement is larger, and the frame doubles on every observer tick
// until the browser's layout ceiling (Blink clamps at 33554428px, about 13 ticks — the readout freezes
// at a nonsense number instead of settling).
//
// It cannot be closed the way the width axis is (measure once, accept once): heights change all the
// time — an accordion opens, a dialog appears — and the frame must follow, so measurements stay live.
// So the loop is detected by its signature: the document keeps growing in response to the height WE
// set. Real content grows once and settles; circular content grows again by a similar factor. After two
// such ticks the frame goes back to the last height that held still and is left there until reset. The
// document then overflows its frame and scrolls inside it, as any content taller than its box does.
//
// SELF-CONTAINED ON PURPOSE. Storefront pages carry no bundle: they inline this factory as
// `createHeightFitter.toString()`. Everything it needs — constants, state, message matching — lives
// inside the function body, and it references nothing from module scope. iframe-fit.spec.ts runs the
// factory's source in an empty scope to keep it that way.

/** What the embedding page does with a decision. Only `write` is required. */
export interface HeightFitAdapter {
  /** Set the frame's height, in CSS px. */
  write(frame: HTMLIFrameElement, height: number): void;
  /** Whether this frame content-fits its height at all (a full-page preview does not). Default: yes. */
  fits?(frame: HTMLIFrameElement): boolean;
  /** Called once when a frame's height turns out to be circular, after it was set back to its steady height. */
  onCircular?(frame: HTMLIFrameElement): void;
  /** Called when a frame's history is forgotten (its document was replaced or restyled). */
  onReset?(frame: HTMLIFrameElement): void;
}

/** Per frame: the height last applied, the last height that held still, and how many growing ticks followed in a row. */
export interface HeightState { last: number; steady: number; run: number }

export interface HeightFitter {
  /** Apply a pd-height measured in `frame`'s document. Returns true when the frame's height was written. */
  accept(frame: HTMLIFrameElement, height: number): boolean;
  /** Forget a frame's height history: growth detection starts over. */
  reset(frame: HTMLIFrameElement): void;
  /** If `event` is a pd-height message from one of `frames`, that frame and its height; otherwise null. */
  fromMessage(event: MessageEvent<unknown>, frames: Iterable<HTMLIFrameElement>): { frame: HTMLIFrameElement; height: number } | null;
  /** Whether `measured` continues a run of growth against the heights we imposed — the loop's signature. */
  isCircularGrowth(previous: HeightState | undefined, measured: number): boolean;
}

export function createHeightFitter(adapter: HeightFitAdapter): HeightFitter {
  /** Growth that counts as "the height we set came back at us". Real content settles after one jump; the
   *  loop multiplies by the same factor every tick (2× for `height: 200vh`). */
  const GROWTH_FACTOR = 1.5;
  /** Consecutive growing ticks before a preview is called circular. One is an accordion; two is a loop. */
  const GROWTH_RUN = 2;

  const state = new WeakMap<HTMLIFrameElement, HeightState>();
  /** Frames whose height is circular: parked at their steady height, left alone until reset. */
  const circular = new WeakSet<HTMLIFrameElement>();

  const isCircularGrowth = (previous: HeightState | undefined, measured: number): boolean =>
    previous !== undefined && measured > previous.last * GROWTH_FACTOR && previous.run + 1 >= GROWTH_RUN;

  return {
    isCircularGrowth,

    accept(frame, height) {
      if ((adapter.fits && !adapter.fits(frame)) || circular.has(frame)) return false;

      const previous = state.get(frame);
      if (previous !== undefined && isCircularGrowth(previous, height)) {
        circular.add(frame);
        state.delete(frame);
        adapter.write(frame, previous.steady);
        if (adapter.onCircular) adapter.onCircular(frame);
        return true;
      }

      const grew = previous !== undefined && height > previous.last * GROWTH_FACTOR;
      state.set(frame, {
        last: height,
        steady: grew && previous ? previous.steady : height,
        run: grew && previous ? previous.run + 1 : 0,
      });
      adapter.write(frame, height);
      return true;
    },

    reset(frame) {
      state.delete(frame);
      circular.delete(frame);
      if (adapter.onReset) adapter.onReset(frame);
    },

    fromMessage(event, frames) {
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== "pd-height" || typeof data.height !== "number") return null;
      for (const frame of frames) {
        if (frame.contentWindow === event.source) return { frame, height: data.height };
      }
      return null;
    },
  };
}

/** The circular-growth rule, for callers without a fitter. The same function every fitter uses. */
export function isCircularGrowth(previous: HeightState | undefined, measured: number): boolean {
  return createHeightFitter({ write: () => {} }).isCircularGrowth(previous, measured);
}
