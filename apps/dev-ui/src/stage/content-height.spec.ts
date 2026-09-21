// The circular-height signature: the document keeps growing in response to the height we set.
import { describe, it, expect } from "vitest";
import { isCircularGrowth } from "./content-height.js";

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
