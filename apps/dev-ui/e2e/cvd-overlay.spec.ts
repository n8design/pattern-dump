import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

// Read computed style of an element inside the srcdoc iframe.
async function innerStyle(
  page: import("@playwright/test").Page,
  selector: string,
  prop: string,
): Promise<string> {
  return page.evaluate(
    ([sel, p]) => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement;
      const el = f.contentDocument!.querySelector(sel) as HTMLElement | null;
      if (!el) return "__NOT_FOUND__";
      return f.contentWindow!.getComputedStyle(el).getPropertyValue(p);
    },
    [selector, prop] as [string, string],
  );
}

// Read the CSS filter applied to the iframe element itself (parent-side).
async function iframeFilter(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement;
    return getComputedStyle(f).filter;
  });
}

// Read the feColorMatrix values from the shell SVG defs.
async function filterMatrixValues(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.getElementById("cvd-matrix-vals");
    return el?.getAttribute("values") ?? "";
  });
}

// ── (b) none → no filter ─────────────────────────────────────────────────────

test("(b) type=none: no filter on the iframe element", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  const f = await iframeFilter(page);
  // filter should be "none" or the empty string — not a url() reference.
  expect(f).not.toMatch(/url\(["']?#cvd/);
});

// ── (a) contamination guard ───────────────────────────────────────────────────

test("(a) contamination guard: child getComputedStyle byte-identical filter-on vs filter-off", async ({ page }) => {
  // Load with a full-severity filter active.
  await gotoComponent(page, "atoms/button", "?cvd=deuteranopia:1.0");

  // Confirm the parent-side filter IS applied to the iframe element.
  const filterOn = await iframeFilter(page);
  expect(filterOn).toMatch(/url\(["']?#cvd/);

  // Read a computed style from INSIDE the srcdoc (background colour of the body).
  const colorWithFilter = await innerStyle(page, "body", "background-color");
  expect(colorWithFilter).not.toBe("__NOT_FOUND__");

  // Navigate to the same component with no CVD param.
  await gotoComponent(page, "atoms/button");
  const filterOff = await iframeFilter(page);
  expect(filterOff).not.toMatch(/url\(["']?#cvd/);

  // The same computed style inside the iframe must be byte-identical.
  const colorWithout = await innerStyle(page, "body", "background-color");
  expect(colorWithFilter).toBe(colorWithout);
});

// ── (c) intermediate severity = interpolated matrix, not scalar-scaling ───────
//
// NOTE: this test is self-referential. The bracket values at severity 0.70 and 0.80
// are read from the SAME implementation table as the 0.73 value, so the test validates
// interpolation CONSISTENCY, not TABLE CORRECTNESS. The fidelity tests below that
// anchor against independently published Machado values are the correctness gate.

test("(c) severity 0.73 produces interpolated matrix, not 0.73 × full-severity matrix", async ({ page }) => {
  // Navigate with intermediate severity.
  await gotoComponent(page, "atoms/button", "?cvd=protanopia:0.73");
  const filterOn = await iframeFilter(page);
  expect(filterOn).toMatch(/url\(["']?#cvd/);

  // Read the actual feColorMatrix values applied.
  const valStr = await filterMatrixValues(page);
  expect(valStr).not.toBe("");

  // Parse the first value (R→R coefficient).
  const r1_073 = Number(valStr.trim().split(/\s+/)[0]);

  // Navigate with severity 1.0 to get the full-deficiency R→R coefficient.
  await gotoComponent(page, "atoms/button", "?cvd=protanopia:1.0");
  const r1_full = Number((await filterMatrixValues(page)).trim().split(/\s+/)[0]);

  // Also read the exact bracketing values. At severity 0.73:
  //   lo = floor(0.73 * 10) = 7 → severity 0.70 step
  //   hi = 8 → severity 0.80 step, t = 0.3
  // Reading the filter at exact step severities gives those table rows directly (t=0).
  await gotoComponent(page, "atoms/button", "?cvd=protanopia:0.70");
  const r1_07 = Number((await filterMatrixValues(page)).trim().split(/\s+/)[0]);

  await gotoComponent(page, "atoms/button", "?cvd=protanopia:0.80");
  const r1_08 = Number((await filterMatrixValues(page)).trim().split(/\s+/)[0]);

  // Correct bracketing interpolation: lerp between the 0.70 and 0.80 Machado steps at t=0.3.
  const expectedInterp = r1_07 + 0.3 * (r1_08 - r1_07);
  // Scalar-scaling would give r1_full * 0.73 — a different (and wrong) model.
  const scalarScale = r1_full * 0.73;

  // Actual must match the bracketing lerp, not scalar-scaling.
  expect(Math.abs(r1_073 - expectedInterp)).toBeLessThan(0.001);
  expect(Math.abs(r1_073 - scalarScale)).toBeGreaterThan(0.01);
});

// ── CVD state is URL-only, never in localStorage ──────────────────────────────

test("CVD params do not write to localStorage", async ({ page }) => {
  await gotoComponent(page, "atoms/button", "?cvd=tritanopia:0.5");

  // Confirm filter is active.
  expect(await iframeFilter(page)).toMatch(/url\(["']?#cvd/);

  // Read the entire localStorage entry — CVD must not appear in it.
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("pd-view-state");
    return raw ?? "";
  });
  expect(stored).not.toContain("cvd");
  expect(stored).not.toContain("tritanopia");
});

// ── Shared-link arrival: URL ?cvd= param restores filter on load ──────────────

test("arriving with ?cvd= URL applies the filter on load", async ({ page }) => {
  await gotoComponent(page, "atoms/button", "?cvd=achromatopsia:1.0");
  expect(await iframeFilter(page)).toMatch(/url\(["']?#cvd/);

  // Also confirm ?cvd= is not stripped from the URL (not a one-shot param).
  expect(page.url()).toContain("cvd=");
});

// ── Table fidelity: assert against published Machado 2009 values (Table 1) ───
//
// The interpolation test (c) is self-referential: bracket values come from the
// SAME implementation table. These tests anchor specific rows against independent
// published values, so corrupted or approximated tables are caught regardless of
// interpolation correctness.
//
// feColorMatrix values format: "m0 m1 m2 0 0  m3 m4 m5 0 0  m6 m7 m8 0 0  0 0 0 1 0"
// At severity 1.0 no interpolation occurs — table[10] is returned directly.

function parseMatrix(valStr: string): number[] {
  const p = valStr.trim().split(/\s+/).map(Number);
  return [p[0], p[1], p[2], p[5], p[6], p[7], p[10], p[11], p[12]];
}

test("(fidelity) deuteranopia severity 1.0 matches published Machado 2009 Table 1", async ({ page }) => {
  await gotoComponent(page, "atoms/button", "?cvd=deuteranopia:1.0");
  const m = parseMatrix(await filterMatrixValues(page));
  // Published values from Machado, Oliveira, Fernandes 2009 — Table 1.
  const expected = [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881];
  expected.forEach((v, i) => expect(m[i]).toBeCloseTo(v, 4));
});

test("(fidelity) tritanopia severity 1.0 matches published Machado 2009 Table 1", async ({ page }) => {
  await gotoComponent(page, "atoms/button", "?cvd=tritanopia:1.0");
  const m = parseMatrix(await filterMatrixValues(page));
  // Published values from Machado, Oliveira, Fernandes 2009 — Table 1.
  const expected = [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900];
  expected.forEach((v, i) => expect(m[i]).toBeCloseTo(v, 4));
});

test("(fidelity) tritanopia severity 0.5 matches published Machado 2009 Table 1", async ({ page }) => {
  await gotoComponent(page, "atoms/button", "?cvd=tritanopia:0.5");
  const m = parseMatrix(await filterMatrixValues(page));
  // Published values from Machado, Oliveira, Fernandes 2009 — Table 1, severity 0.5.
  // R→R = 1.017277 (above 1.0); a linear approximation gives 1.127764 — a 0.11 error
  // that only the physiological table (not a linear ramp) can produce correctly.
  const expected = [1.017277, 0.027029, -0.044306, -0.006113, 0.958479, 0.047634, 0.006379, 0.248708, 0.744913];
  expected.forEach((v, i) => expect(m[i]).toBeCloseTo(v, 4));
});
