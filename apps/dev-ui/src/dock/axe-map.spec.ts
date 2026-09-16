// Unit tests for the axe-core -> A11yDiagnostic mapping. Node environment, no DOM.
//
// The violations/incomplete asymmetry is the reason this file exists. It looks like duplication, so
// it is the thing a future "simplification" would collapse — and collapsing it degrades every
// needs-review message to generic rule text while every test that only counts diagnostics stays green.

import { describe, it, expect } from "vitest";
import { mapAxeResults } from "./axe-map.js";

const node = (over: Record<string, unknown> = {}) => ({
  target: ["main", "button"], html: "<button></button>",
  failureSummary: "Fix any of the following: ...", ...over,
});
const rule = (over: Record<string, unknown> = {}) => ({
  id: "color-contrast", impact: "serious", description: "Elements must have contrast",
  help: "Contrast", helpUrl: "https://dequeuniversity.com/x", nodes: [node()], ...over,
});

describe("mapAxeResults — empty and shape", () => {
  it("returns nothing for empty input", () => {
    expect(mapAxeResults({})).toEqual([]);
    expect(mapAxeResults({ violations: [], incomplete: [] })).toEqual([]);
  });

  it("emits one diagnostic per NODE, not per rule", () => {
    const out = mapAxeResults({ violations: [rule({ nodes: [node(), node(), node()] })] });
    expect(out).toHaveLength(3);
  });

  it("joins the target selector chain with ' > '", () => {
    const out = mapAxeResults({ violations: [rule({ nodes: [node({ target: ["main", "p", "a"] })] })] });
    expect(out[0]!.target).toBe("main > p > a");
  });

  it("defaults nodeHtml to an empty string rather than undefined", () => {
    const n = node(); delete (n as Record<string, unknown>)["html"];
    expect(mapAxeResults({ violations: [rule({ nodes: [n] })] })[0]!.nodeHtml).toBe("");
  });
});

describe("mapAxeResults — severity from impact", () => {
  it.each([["critical", "error"], ["serious", "error"], ["moderate", "warning"], ["minor", "warning"]])(
    "impact %s -> severity %s", (impact, severity) => {
      expect(mapAxeResults({ violations: [rule({ impact })] })[0]!.severity).toBe(severity);
    },
  );

  it("treats an unknown or missing impact as warning, not error", () => {
    expect(mapAxeResults({ violations: [rule({ impact: undefined })] })[0]!.severity).toBe("warning");
  });
});

describe("mapAxeResults — the violations/incomplete asymmetry", () => {
  it("violation: failureSummary wins, and needsReview is absent", () => {
    const out = mapAxeResults({ violations: [rule({ nodes: [node({ failureSummary: "SUMMARY" })] })] });
    expect(out[0]!.message).toBe("SUMMARY");
    expect(out[0]!.needsReview).toBeUndefined();
  });

  it("incomplete: any[0].message wins OVER failureSummary — the actionable half", () => {
    const n = node({ failureSummary: "SUMMARY", any: [{ message: "WHY AXE COULD NOT DECIDE" }] });
    const out = mapAxeResults({ incomplete: [rule({ nodes: [n] })] });
    expect(out[0]!.message).toBe("WHY AXE COULD NOT DECIDE");
    expect(out[0]!.needsReview).toBe(true);
  });

  it("incomplete: falls back to failureSummary when any[0] carries no message", () => {
    const out = mapAxeResults({ incomplete: [rule({ nodes: [node({ any: [{}] })] })] });
    expect(out[0]!.message).toBe("Fix any of the following: ...");
  });

  it("falls back to the rule description when neither is present", () => {
    const n = node({ failureSummary: undefined });
    expect(mapAxeResults({ incomplete: [rule({ nodes: [n] })] })[0]!.message)
      .toBe("Elements must have contrast");
  });

  it("a violation ignores any[0].message — the branches are not interchangeable", () => {
    // The discriminator. If the two branches were collapsed, this message would become
    // "IGNORE ME" and this is the only test that would notice.
    const n = node({ failureSummary: "SUMMARY", any: [{ message: "IGNORE ME" }] });
    expect(mapAxeResults({ violations: [rule({ nodes: [n] })] })[0]!.message).toBe("SUMMARY");
  });

  it("maps violations before incomplete, preserving tier order", () => {
    const out = mapAxeResults({
      violations: [rule({ id: "v" })],
      incomplete: [rule({ id: "i" })],
    });
    expect(out.map(d => d.ruleId)).toEqual(["v", "i"]);
  });
});

describe("mapAxeResults — contrast swatches", () => {
  const withData = (data: Record<string, unknown>) =>
    rule({ nodes: [node({ any: [{ data }] })] });

  it("populates contrast when axe resolved both colours", () => {
    const out = mapAxeResults({ violations: [withData({
      fgColor: "#777", bgColor: "#fff", contrastRatio: 4.48, expectedContrastRatio: "4.5:1",
    })] });
    expect(out[0]!.contrast).toEqual({ fg: "#777", bg: "#fff", ratio: 4.48, expected: 4.5 });
  });

  it("parses expectedContrastRatio out of its '4.5:1' string form", () => {
    const out = mapAxeResults({ violations: [withData({
      fgColor: "#000", bgColor: "#fff", contrastRatio: 21, expectedContrastRatio: "7:1",
    })] });
    expect(out[0]!.contrast!.expected).toBe(7);
  });

  it("omits contrast when axe could not resolve the foreground", () => {
    const out = mapAxeResults({ violations: [withData({ bgColor: "#fff" })] });
    expect(out[0]!.contrast).toBeUndefined();
  });

  it("omits contrast for any rule that is not color-contrast", () => {
    const out = mapAxeResults({ violations: [rule({
      id: "image-alt", nodes: [node({ any: [{ data: { fgColor: "#777" } }] })],
    })] });
    expect(out[0]!.contrast).toBeUndefined();
  });
});
