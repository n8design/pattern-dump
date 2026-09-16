// Always-on structural a11y producer (M4.10).
// Parses the rendered HTML fragment with jsdom, runs the jsdom-clean axe rule set,
// and maps each failing node to an A11yDiagnostic.
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import type { A11yDiagnostic } from "@pattern-dump/contracts";
import ruleTiers from "./rule-tiers.generated.json" with { type: "json" };

// axe-core ships as CJS; createRequire gives reliable ESM interop.
const require = createRequire(import.meta.url);
const axe = require("axe-core") as typeof import("axe-core");

const SEVERITY_MAP: Record<string, A11yDiagnostic["severity"]> = {
  critical: "error",
  serious: "error",
  moderate: "warning",
  minor: "warning",
};

/**
 * Run the always-on axe structural rule set against the rendered HTML fragment.
 * Returns one A11yDiagnostic per failing DOM node (independent dismissal; per-node target).
 */
export async function runA11yProducer(html: string): Promise<A11yDiagnostic[]> {
  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="en"><body><main>${html}</main></body></html>`,
    { url: "http://localhost" }
  );
  // No axe.setup()/teardown() cycling — crashes in node/jsdom (spike finding).
  // axe.reset() omitted — we never change config between renders.
  const { violations } = await axe.run(
    dom.window.document.querySelector("main")!,
    { runOnly: { type: "rule", values: ruleTiers.alwaysOn } }
  );
  const diagnostics: A11yDiagnostic[] = [];
  for (const v of violations) {
    for (const node of v.nodes) {
      diagnostics.push({
        kind: "A11Y",
        source: "axe",
        severity: SEVERITY_MAP[v.impact ?? ""] ?? "warning",
        message: node.failureSummary ?? v.description,
        ruleId: v.id,
        target: node.target.join(" > "),
        nodeHtml: node.html,
        help: v.help,
        helpUrl: v.helpUrl,
      });
    }
  }
  return diagnostics;
}
