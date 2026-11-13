// Page rule classifier: which axe rules can be decided on a whole page in jsdom (no browser, no layout), from a
// failing and a passing page per candidate rule (page-fixtures.ts). Writes page-rule-tiers.generated.json:
//   jsdom    the failing page is a violation in jsdom and the passing page is clean: `pd build` runs these.
//   browser  every other rule of the tags, fixtures or not: `pd build --browser` runs these in Chromium.
// A failing page that gives neither a violation nor an incomplete result is a wrong fixture: the run fails.
// Run via: npm run classify-pages --workspace @pattern-dump/a11y (classify-pages.ts), and after every axe-core bump:
// the diff shows what moved.
import { PAGE_TAGS, runAxeOnPage } from "./page.js";
import { PAGE_FIXTURES } from "./page-fixtures.js";

type Verdict = "jsdom" | "browser" | "fixture";

/** One rule's verdict, and why. */
export async function classifyPageRule(ruleId: string, fail: string, pass: string): Promise<{ verdict: Verdict; why: string }> {
  const f = await runAxeOnPage(fail, [ruleId]);
  const p = await runAxeOnPage(pass, [ruleId]);
  const fv = f.violations.length, fi = f.incomplete.length, pv = p.violations.length, pi = p.incomplete.length;
  if (fv === 0 && fi === 0) return { verdict: "fixture", why: "its failing page is neither a violation nor incomplete in jsdom" };
  if (fv > 0 && fi === 0 && pv === 0 && pi === 0) return { verdict: "jsdom", why: "decided" };
  return { verdict: "browser", why: fv === 0 ? "the failing page is incomplete" : pv > 0 ? "the passing page is a violation" : "incomplete results" };
}

export async function classifyPages(): Promise<{ axeVersion: string; jsdom: string[]; browser: string[]; why: Record<string, string> }> {
  const { axeVersion, ruleIds } = await runAxeOnPage("<!DOCTYPE html><html lang=\"en\"><head><title>x</title></head><body></body></html>", []);
  const jsdom: string[] = [];
  const why: Record<string, string> = {};
  const wrong: string[] = [];
  for (const { ruleId, fail, pass } of PAGE_FIXTURES) {
    if (!ruleIds.includes(ruleId)) throw new Error(`${ruleId} is not an axe-core ${axeVersion} rule under ${PAGE_TAGS.join(", ")}; update page-fixtures.ts`);
    const r = await classifyPageRule(ruleId, fail, pass);
    why[ruleId] = r.why;
    if (r.verdict === "jsdom") jsdom.push(ruleId);
    if (r.verdict === "fixture") wrong.push(`${ruleId}: ${r.why}`);
  }
  if (wrong.length) throw new Error(`fix these fixtures in page-fixtures.ts:\n${wrong.map(w => `  - ${w}`).join("\n")}`);
  const browser = ruleIds.filter(id => !jsdom.includes(id));
  for (const id of browser) why[id] ??= "no fixture";
  return { axeVersion, jsdom: jsdom.sort(), browser: browser.sort(), why };
}
