// pd audit's summary (auditSummaryLines): the image warning, when there is one, is one line for the whole audit.
import { describe, expect, it } from "vitest";
import { auditSummaryLines } from "../src/index.js";

const base = {
  graph: { components: [{}, {}, {}] as never[], occurrences: [{ component: "atoms/a" }, { component: "atoms/a" }] as never[] },
  reaudited: 3, reused: 0, artifactPath: "/tmp/graph.json", reportPath: "/tmp/report.md",
};

describe("pd audit's summary", () => {
  it("says what was audited and where its files are", () => {
    expect(auditSummaryLines(base)).toEqual([
      "[pd audit] re-audited 3, reused 0 (of 3).",
      "[pd audit] serialized graph: /tmp/graph.json",
      "[pd audit] report: /tmp/report.md",
      "[pd audit] 2 defects across 1/3 components.",
    ]);
  });

  it("ends with the image warning, once", () => {
    const lines = auditSummaryLines({ ...base, imageWarning: "Pattern Dump could not load sharp (…)." });
    expect(lines.filter(l => l.includes("could not load sharp"))).toEqual(["[pd audit] warning: Pattern Dump could not load sharp (…)."]);
    expect(lines.at(-1)).toBe("[pd audit] warning: Pattern Dump could not load sharp (…).");
  });
});
