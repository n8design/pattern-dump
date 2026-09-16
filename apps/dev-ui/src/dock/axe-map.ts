// axe-core result -> A11yDiagnostic mapping.
//
// Pure: takes axe's raw output, returns diagnostics. No DOM, no module state — the scan that
// produces the input lives in main.ts and stays there, because it owns the `scanGen` generation
// counter that discards superseded scans.
//
// The violations/incomplete asymmetry is the substance here and is easy to "simplify" wrongly:
// for a VIOLATION, axe's failureSummary is the primary message; for an INCOMPLETE ("needs review")
// result, the actionable part is any[0].message — the reason axe could not decide — and
// failureSummary is only a fallback. Collapsing the two branches would silently degrade every
// needs-review message to generic rule text.

import type { A11yDiagnostic } from "@pattern-dump/contracts";

export function mapAxeResults(results: { violations?: unknown[]; incomplete?: unknown[] }): A11yDiagnostic[] {
  const out: A11yDiagnostic[] = [];

  function mapNodes(v: Record<string, unknown>, needsReview: boolean): void {
    const impact = v["impact"] as string;
    const severity = (impact === "critical" || impact === "serious") ? "error" as const : "warning" as const;
    for (const n of (v["nodes"] ?? []) as Record<string, unknown>[]) {
      const target = ((n["target"] as string[] | undefined) ?? []).join(" > ");
      const any0 = ((n["any"] as unknown[] | undefined)?.[0]) as Record<string, unknown> | undefined;
      // Violations: failureSummary is the primary message.
      // Incomplete: any[0].message is the reason axe couldn't decide (the actionable part).
      const message = needsReview
        ? (any0?.["message"] as string | undefined) ?? (n["failureSummary"] as string | undefined) ?? (v["description"] as string)
        : (n["failureSummary"] as string | undefined) ?? (v["description"] as string);
      const d: A11yDiagnostic = {
        kind: "A11Y", source: "axe", severity,
        message,
        ruleId: v["id"] as string,
        target,
        nodeHtml: (n["html"] as string | undefined) ?? "",
        help: v["help"] as string,
        helpUrl: v["helpUrl"] as string,
        ...(needsReview ? { needsReview: true } : {}),
      };
      // Populate contrast swatches when axe resolved both fg and bg colors.
      if (v["id"] === "color-contrast") {
        const data = any0?.["data"] as Record<string, unknown> | undefined;
        if (data?.["fgColor"]) {
          d.contrast = {
            fg: data["fgColor"] as string,
            bg: data["bgColor"] as string,
            ratio: data["contrastRatio"] as number,
            expected: parseFloat(data["expectedContrastRatio"] as string),
          };
        }
      }
      out.push(d);
    }
  }

  for (const v of (results.violations ?? []) as Record<string, unknown>[]) {
    mapNodes(v, false);
  }
  for (const v of (results.incomplete ?? []) as Record<string, unknown>[]) {
    mapNodes(v, true);
  }

  return out;
}
