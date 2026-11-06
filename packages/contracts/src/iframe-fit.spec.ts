// The shared preview height fitter (iframe-fit.ts): the circular-growth rule, the state machine every
// embedding page relies on, and the property storefront pages depend on — the factory's source runs on
// its own, with no access to this module's scope.
import { describe, it, expect } from "vitest";
import { createHeightFitter, isCircularGrowth, type HeightFitAdapter } from "./iframe-fit.js";

// The circular-height signature: the document keeps growing in response to the height we set.
// (Moved unchanged from apps/dev-ui/src/stage/content-height.spec.ts.)
describe("isCircularGrowth", () => {
  it("is false for the first measurement of a document", () => {
    expect(isCircularGrowth(undefined, 4000)).toBe(false);
  });

  it("is false for a single jump: content grew once and will settle", () => {
    // An accordion opens: one big growth, no run behind it.
    expect(isCircularGrowth({ last: 200, steady: 200, run: 0 }, 900)).toBe(false);
  });

  it("is true for a second growth in a row", () => {
    // height: 200vh — each tick doubles what we just applied.
    expect(isCircularGrowth({ last: 900, steady: 200, run: 1 }, 1800)).toBe(true);
  });

  it("is false while the height holds still or shrinks", () => {
    expect(isCircularGrowth({ last: 900, steady: 200, run: 1 }, 900)).toBe(false);
    expect(isCircularGrowth({ last: 900, steady: 200, run: 1 }, 400)).toBe(false);
    // Growth under the factor is ordinary reflow (a font loading, a wrapped line).
    expect(isCircularGrowth({ last: 900, steady: 900, run: 1 }, 1200)).toBe(false);
  });
});

// Frames are only identities to the fitter (WeakMap keys, `contentWindow` for message matching), so
// plain objects stand in for iframes.
type Frame = HTMLIFrameElement;
const frame = (): Frame => ({ contentWindow: {} }) as unknown as Frame;

function recorder(extra: Partial<HeightFitAdapter> = {}) {
  const log: string[] = [];
  const adapter: HeightFitAdapter = {
    write: (_f, h) => log.push(`write ${h}`),
    onCircular: () => log.push("circular"),
    onReset: () => log.push("reset"),
    ...extra,
  };
  return { log, adapter };
}

/** The behaviour the workbench Stage had before the fitter moved into contracts, as a sequence. */
function exercise(create: typeof createHeightFitter) {
  const { log, adapter } = recorder();
  const fit = create(adapter);
  const f = frame();
  const results = [
    fit.accept(f, 200),   // first measurement: applied
    fit.accept(f, 900),   // one jump (an accordion): applied, run 1
    fit.accept(f, 900),   // holds still: applied, run back to 0
    fit.accept(f, 1800),  // grows again: run 1 — not yet circular
    fit.accept(f, 3600),  // grows again: circular — parked at the steady height (900)
    fit.accept(f, 7200),  // circular frames are left alone
  ];
  fit.reset(f);
  results.push(fit.accept(f, 300)); // after a reset, fitting starts over
  return { log, results };
}

const EXPECTED = {
  log: ["write 200", "write 900", "write 900", "write 1800", "write 900", "circular", "reset", "write 300"],
  results: [true, true, true, true, true, false, true],
};

describe("createHeightFitter", () => {
  it("applies heights, parks a circular frame at its steady height, and starts over after a reset", () => {
    expect(exercise(createHeightFitter)).toEqual(EXPECTED);
  });

  it("leaves frames that do not fit their height alone (full-page previews)", () => {
    const { log, adapter } = recorder({ fits: () => false });
    const fit = createHeightFitter(adapter);
    expect(fit.accept(frame(), 500)).toBe(false);
    expect(log).toEqual([]);
  });

  it("keeps separate history per frame", () => {
    const { log, adapter } = recorder();
    const fit = createHeightFitter(adapter);
    const a = frame(), b = frame();
    fit.accept(a, 200); fit.accept(a, 900);   // a: one jump
    fit.accept(b, 200); fit.accept(b, 900);   // b: one jump — not a run with a's
    expect(log).toEqual(["write 200", "write 900", "write 200", "write 900"]);
  });

  it("matches a pd-height message to the frame that sent it, and nothing else", () => {
    const fit = createHeightFitter({ write: () => {} });
    const a = frame(), b = frame();
    const msg = (data: unknown, source: unknown) => ({ data, source }) as MessageEvent<unknown>;
    expect(fit.fromMessage(msg({ type: "pd-height", height: 120 }, b.contentWindow), [a, b])).toEqual({ frame: b, height: 120 });
    expect(fit.fromMessage(msg({ type: "pd-height", height: 120 }, {}), [a, b])).toBeNull();          // not one of ours
    expect(fit.fromMessage(msg({ type: "pd-width", width: 120 }, a.contentWindow), [a, b])).toBeNull(); // another message
    expect(fit.fromMessage(msg({ type: "pd-height", height: "120" }, a.contentWindow), [a, b])).toBeNull();
    expect(fit.fromMessage(msg(null, a.contentWindow), [a, b])).toBeNull();
  });
});

// Storefront pages carry no bundle: they inline `createHeightFitter.toString()`. That only works while
// the factory references nothing outside its own body — no module-level constant, no helper a bundler
// adds (keepNames' __name, a lowering helper). Evaluated in an empty scope, it must behave exactly as
// the imported one.
describe("createHeightFitter source, run on its own", () => {
  it("behaves identically with no access to this module's scope", () => {
    const source = createHeightFitter.toString();
    const isolated = new Function(`"use strict"; return (${source});`)() as typeof createHeightFitter;
    expect(isolated).not.toBe(createHeightFitter);
    expect(exercise(isolated)).toEqual(EXPECTED);
  });
});
