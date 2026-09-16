// Unit tests for the CVD simulation maths — the first this code has had.
//
// Possible now only because cvd-math.ts exists: main.ts has no exports and importing it runs the
// whole app, so none of this was reachable from a test before the extraction. Runs in the default
// node environment; `import type { CvdType }` is erased, so nothing pulls in the DOM.
//
// The E2E fidelity tests (cvd-overlay.spec.ts) already check three published Machado points through
// the rendered filter. These cover what E2E cannot see cheaply: the interpolation arithmetic, the
// clamping boundaries, and the feColorMatrix serialisation shape.

import { describe, it, expect } from "vitest";
import { CVD_IDENTITY, cvdLinearTable, MACHADO, computeCvdMatrix, cvdMatrixToValues } from "./cvd-math.js";

describe("CVD_IDENTITY", () => {
  it("is the 3x3 identity in row-major order", () => {
    expect(CVD_IDENTITY).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe("cvdLinearTable", () => {
  const full = [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722];

  it("produces 11 entries — severity 0.0 to 1.0 at 0.1 steps", () => {
    expect(cvdLinearTable(full)).toHaveLength(11);
  });

  it("starts at identity and ends at the full matrix", () => {
    const t = cvdLinearTable(full);
    expect(t[0]).toEqual(CVD_IDENTITY);
    t[10]!.forEach((v, i) => expect(v).toBeCloseTo(full[i]!, 10));
  });

  it("interpolates linearly — the midpoint is the average of the endpoints", () => {
    const t = cvdLinearTable(full);
    t[5]!.forEach((v, i) => expect(v).toBeCloseTo((CVD_IDENTITY[i]! + full[i]!) / 2, 10));
  });
});

describe("MACHADO", () => {
  it("has 11 severity steps of 9 coefficients for every type", () => {
    for (const [type, table] of Object.entries(MACHADO)) {
      expect(table, type).toHaveLength(11);
      for (const row of table) expect(row, type).toHaveLength(9);
    }
  });

  it("starts every type at identity (severity 0 is a no-op)", () => {
    for (const [type, table] of Object.entries(MACHADO)) {
      expect(table[0], type).toEqual(CVD_IDENTITY);
    }
  });

  it("keeps tritanopia's non-monotonic R->R curve", () => {
    // Documented in the source: R->R dips below 1 at low severity, then rises past it, peaking
    // around severity 0.9. A 'tidying' refactor that regenerated this as a linear ramp would break
    // physiological accuracy while still looking plausible — this is the guard against that.
    const rr = MACHADO.tritanopia.map(row => row[0]!);
    expect(rr[2]).toBeLessThan(1);
    expect(rr[9]).toBeGreaterThan(1);
    expect(Math.max(...rr)).toBeCloseTo(rr[9]!, 10);
  });
});

describe("computeCvdMatrix", () => {
  it("clamps at and below zero severity to identity", () => {
    expect(computeCvdMatrix("protanopia", 0)).toEqual(CVD_IDENTITY);
    expect(computeCvdMatrix("protanopia", -1)).toEqual(CVD_IDENTITY);
  });

  it("clamps at and above full severity to the last table row", () => {
    expect(computeCvdMatrix("protanopia", 1)).toEqual(MACHADO.protanopia[10]);
    expect(computeCvdMatrix("protanopia", 5)).toEqual(MACHADO.protanopia[10]);
  });

  it("returns exact table rows on the 0.1 grid, without interpolation drift", () => {
    for (let i = 0; i <= 10; i++) {
      const got = computeCvdMatrix("deuteranopia", i / 10);
      got.forEach((v, j) => expect(v).toBeCloseTo(MACHADO.deuteranopia[i]![j]!, 10));
    }
  });

  it("interpolates between the two bracketing rows, not from identity", () => {
    // The discriminator: severity 0.75 must be the midpoint of rows 7 and 8 — NOT 0.75x the
    // full-severity matrix, which is the naive implementation and is visibly wrong for tritanopia.
    const got = computeCvdMatrix("tritanopia", 0.75);
    const a = MACHADO.tritanopia[7]!;
    const b = MACHADO.tritanopia[8]!;
    got.forEach((v, i) => expect(v).toBeCloseTo((a[i]! + b[i]!) / 2, 10));

    const naive = MACHADO.tritanopia[10]!.map(v => v * 0.75);
    expect(got).not.toEqual(naive);
  });

  it("does not mutate the source table", () => {
    const before = structuredClone(MACHADO.protanopia);
    computeCvdMatrix("protanopia", 0.35);
    computeCvdMatrix("protanopia", 0);
    expect(MACHADO.protanopia).toEqual(before);
  });
});

describe("cvdMatrixToValues", () => {
  it("serialises a 3x3 into feColorMatrix's 20 values, alpha untouched", () => {
    const out = cvdMatrixToValues([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.split(/\s+/).filter(Boolean)).toHaveLength(20);
    // 4 rows x 5 cols (R,G,B,A,1): each colour row is [r,g,b,0,0]; the alpha row passes through.
    expect(out.split(/\s+/).filter(Boolean)).toEqual(
      ["1","2","3","0","0", "4","5","6","0","0", "7","8","9","0","0", "0","0","0","1","0"],
    );
  });

  it("round-trips identity to a no-op matrix", () => {
    const vals = cvdMatrixToValues(CVD_IDENTITY).split(/\s+/).filter(Boolean).map(Number);
    expect(vals).toEqual([1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0]);
  });
});
