import { describe, it, expect, vi } from "vitest";
import { setVpProp } from "./preview-sizing";

// A minimal element stub — the guard only touches el.style.{getPropertyValue,setProperty}, so no
// DOM is needed. setProperty is spied so we assert the DEFECT directly: a no-op write must NOT fire.
function mockEl(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  const setProperty = vi.fn((k: string, v: string) => { store[k] = v; });
  const el = { style: { getPropertyValue: (k: string) => store[k] ?? "", setProperty } };
  return el as unknown as HTMLElement & { style: { setProperty: ReturnType<typeof vi.fn> } };
}

// This tests the defect, not the environment. Posting pd-height equal to the current --vp-h must not
// write the property — because a no-op custom-property write forces a recalc that re-triggers the
// srcdoc ResizeObserver (the feedback loop the width handler's comment already named). Fails without
// the guard, passes with it, at any DPR, in CI.
//
// NOTE — the DPR-1 blind spot: the emergent loop only sustains on real sub-pixel (Retina) + a
// late-loading font keeping the body's height moving, so a full-browser "pd-height settles" test at
// DPR 1 would be vacuous (it settles with or without the guard). That is exactly why this shipped:
// every existing fixture happens to lay out at integer heights. This unit test sidesteps that by
// asserting the convergence CONDITION, which holds at any DPR.
describe("setVpProp — the RO feedback-loop guard (no-op custom-property write is skipped)", () => {
  it("does NOT write --vp-h when the posted value equals the current value", () => {
    const el = mockEl({ "--vp-h": "270px" });
    setVpProp(el, "--vp-h", 270);
    expect(el.style.setProperty).not.toHaveBeenCalled();
  });

  it("does NOT write when within 1px (sub-pixel jitter is a no-op too)", () => {
    const el = mockEl({ "--vp-h": "270px" });
    setVpProp(el, "--vp-h", 270.4);
    expect(el.style.setProperty).not.toHaveBeenCalled();
  });

  it("DOES write --vp-h on a real change (>1px)", () => {
    const el = mockEl({ "--vp-h": "270px" });
    setVpProp(el, "--vp-h", 300);
    expect(el.style.setProperty).toHaveBeenCalledWith("--vp-h", "300px");
  });

  it("width gets the identical guard (both paths share this function)", () => {
    const el = mockEl({ "--vp-w": "200px" });
    setVpProp(el, "--vp-w", 200);
    expect(el.style.setProperty).not.toHaveBeenCalled();
    setVpProp(el, "--vp-w", 240);
    expect(el.style.setProperty).toHaveBeenCalledWith("--vp-w", "240px");
  });

  it("always writes the first time — a keyword seed (max-content → NaN → 0) is never a no-op", () => {
    const el = mockEl({ "--vp-w": "max-content" });
    setVpProp(el, "--vp-w", 200);
    expect(el.style.setProperty).toHaveBeenCalledWith("--vp-w", "200px");
  });
});
