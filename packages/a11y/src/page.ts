// axe on a whole page, in jsdom: what `pd build` runs on every storefront page (step 6b). Each page gets its own jsdom
// window with axe loaded into it, so runs are isolated and can overlap. Only the rules decided in jsdom run
// (page-rule-tiers.generated.json, from page-classifier.ts); the rest need a browser (`pd build --browser`).
//
// Severity: a WCAG rule (any wcag* tag) found critical or serious is an error; moderate and minor are warnings; a
// best-practice rule is a warning whatever its impact. Incomplete results (axe couldn't decide) are not reported.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import pageTiers from "./page-rule-tiers.generated.json" with { type: "json" };

const require = createRequire(import.meta.url);
let axeSource: string | undefined;
const source = (): string => (axeSource ??= readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"));

/** The axe tags a site page is checked against. */
export const PAGE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

interface AxeNode { target: unknown[]; html: string; failureSummary?: string }
interface AxeResult { id: string; impact?: string | null; tags: string[]; help: string; helpUrl: string; nodes: AxeNode[] }

/** axe's raw results for `html` with `rules` (all of PAGE_TAGS when empty), and the rules those tags hold. */
export async function runAxeOnPage(html: string, rules: string[]): Promise<{
  violations: AxeResult[]; incomplete: AxeResult[]; axeVersion: string; ruleIds: string[];
}> {
  const dom = new JSDOM(html, { url: "http://site.invalid/", runScripts: "outside-only", pretendToBeVisual: true });
  // A canvas jsdom can't draw on: axe probes for one and carries on without it.
  dom.virtualConsole.removeAllListeners();
  try {
    dom.window.eval(source());
    const axe = (dom.window as unknown as { axe: {
      run(context: unknown, options: unknown): Promise<{ violations: AxeResult[]; incomplete: AxeResult[] }>;
      getRules(tags: string[]): Array<{ ruleId: string }>; version: string;
    } }).axe;
    const ruleIds = axe.getRules(PAGE_TAGS).map(r => r.ruleId);
    const options = rules.length ? { runOnly: { type: "rule", values: rules } } : { runOnly: { type: "tag", values: PAGE_TAGS } };
    const r = await axe.run(dom.window.document, { ...options, resultTypes: ["violations", "incomplete"] });
    return { violations: r.violations, incomplete: r.incomplete, axeVersion: axe.version, ruleIds };
  } finally {
    dom.window.close();
  }
}

/** One rule a page fails, with every element that fails it. */
export interface PageA11yFinding {
  ruleId: string;
  severity: "error" | "warning";
  impact: string;
  help: string;
  helpUrl: string;
  nodes: Array<{ target: string; html: string }>;
}

/** Whether a rule found with `impact` and `tags` stops the build. */
export function severityOf(impact: string | null | undefined, tags: readonly string[]): "error" | "warning" {
  const wcag = tags.some(t => /^wcag\d/.test(t));
  return wcag && (impact === "critical" || impact === "serious") ? "error" : "warning";
}

/** The rules of a site page decided in jsdom, run on `html`: every rule it fails. */
export async function runPageA11y(html: string): Promise<PageA11yFinding[]> {
  const { violations } = await runAxeOnPage(html, pageTiers.jsdom);
  return violations.map(v => ({
    ruleId: v.id, severity: severityOf(v.impact, v.tags), impact: v.impact ?? "minor", help: v.help, helpUrl: v.helpUrl,
    nodes: v.nodes.map(n => ({ target: n.target.map(String).join(" "), html: n.html })),
  }));
}

/** The page rule tiers, as data: the rules decided in jsdom, and those that need a browser. */
export const pageRuleTiers: { axeVersion: string; tags: string[]; jsdom: string[]; browser: string[] } = pageTiers;
