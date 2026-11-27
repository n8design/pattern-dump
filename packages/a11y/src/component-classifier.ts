// Component rule classifier: probes each axe candidate rule against a failing fixture in jsdom. classifier.ts writes
// its result to rule-tiers.generated.json; test/classifier.spec.ts checks the committed file against a fresh run.
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

// axe-core ships as CJS; use createRequire for reliable ESM interop.
const require = createRequire(import.meta.url);
const axe = require("axe-core") as typeof import("axe-core");

// ─── Fixture table ────────────────────────────────────────────────────────────
// One deliberately-failing fixture per candidate rule (from the jsdom rule-split spike).
export const CANDIDATES: { ruleId: string; fixture: string }[] = [
  { ruleId: "image-alt",            fixture: '<img src="x.jpg">' },
  { ruleId: "label",                fixture: '<input type="text">' },
  { ruleId: "button-name",          fixture: "<button></button>" },
  { ruleId: "link-name",            fixture: '<a href="#"></a>' },
  { ruleId: "aria-required-attr",   fixture: '<div role="checkbox"></div>' },
  { ruleId: "aria-valid-attr",      fixture: '<div aria-xyz="true"></div>' },
  { ruleId: "aria-valid-attr-value",fixture: '<div role="textbox" aria-expanded="maybe"></div>' },
  { ruleId: "autocomplete-valid",   fixture: '<input autocomplete="foo">' },
  { ruleId: "duplicate-id",         fixture: '<div id="d1"></div><div id="d1"></div>' },
  { ruleId: "aria-hidden-focus",    fixture: '<div aria-hidden="true"><button>x</button></div>' },
  { ruleId: "duplicate-id-aria",    fixture: '<span id="x"></span><span id="x"></span><input aria-labelledby="x">' },
  { ruleId: "color-contrast",       fixture: '<p style="color:#bbb;background:#fff">Low contrast</p>' },
];

export type Verdict = "jsdom-clean" | "needs-rendering" | "investigate";

export interface ClassifierResult {
  ruleId: string;
  verdict: Verdict;
  violations: number;
  incomplete: number;
}

export async function classifyRule(ruleId: string, fixture: string): Promise<ClassifierResult> {
  // url required so axe can read location.origin without hitting a null-ref in node mode.
  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="en"><body><main>${fixture}</main></body></html>`,
    { url: "http://localhost" }
  );
  // No axe.reset() — we never change axe config between probes, and reset() crashes in node/jsdom
  // when called without a live global window (spike finding: no setup/teardown cycling).
  const results = await axe.run(
    dom.window.document.querySelector("main")!,
    { runOnly: { type: "rule", values: [ruleId] } }
  );
  const violations = results.violations.length;
  const incomplete = results.incomplete.length;
  let verdict: Verdict;
  if (violations > 0) {
    verdict = "jsdom-clean";
  } else if (incomplete > 0) {
    verdict = "needs-rendering";
  } else {
    verdict = "investigate";
  }
  return { ruleId, verdict, violations, incomplete };
}

/** Every candidate's verdict for the installed axe-core. Throws on a candidate that is no longer an axe rule, and on
 *  any verdict of "investigate": a fixture to fix before the result is used. */
export async function classifyComponents(): Promise<{ axeVersion: string; results: ClassifierResult[]; alwaysOn: string[]; needsRendering: string[] }> {
  // Pre-check: every fixture's ruleId must exist in the installed axe version.
  const liveRuleIds = new Set(axe.getRules().map((r: { ruleId: string }) => r.ruleId));
  const axeVersion = (axe as unknown as { version: string }).version ?? "unknown";
  for (const { ruleId } of CANDIDATES) {
    if (!liveRuleIds.has(ruleId)) {
      throw new Error(
        `Rule "${ruleId}" no longer exists in axe-core ${axeVersion}. ` +
        `Update CANDIDATES in component-classifier.ts to reflect the current rule set.`
      );
    }
  }
  const results: ClassifierResult[] = [];
  for (const { ruleId, fixture } of CANDIDATES) results.push(await classifyRule(ruleId, fixture));

  // Fail loudly if anything is in "investigate": don't emit an artifact with unknowns.
  const investigate = results.filter(r => r.verdict === "investigate");
  if (investigate.length > 0) {
    throw new Error(
      `${investigate.length} rule(s) in "investigate" bucket: ${investigate.map(r => r.ruleId).join(", ")}. ` +
      `Add specific fixtures for these rules before committing the artifact.`
    );
  }
  return {
    axeVersion, results,
    alwaysOn: results.filter(r => r.verdict === "jsdom-clean").map(r => r.ruleId),
    needsRendering: results.filter(r => r.verdict === "needs-rendering").map(r => r.ruleId),
  };
}
