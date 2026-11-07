// Corpus Audit facet (Inspector panel, third tab).
//
// Coverage before this file: ONE assertion in the whole 280-test suite — layout.spec.ts:207
// checking that a tab labelled "Audit" exists. Nothing exercised loadAudit()'s four states, the
// rendered rollup, the audit-link click-through, or the HMR freshness hook. These tests are written
// against the CURRENT implementation, deliberately, so they can serve as a characterisation net for
// the main.ts decomposition: a pure code move must not change any assertion here.

import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testBench = path.resolve(__dirname, "../../../test-bench");

/** Panel tabs share the `data-tab` attribute with the dock tabs — always scope to .panel-tabs. */
const PANEL_TAB = (name: string) => `.panel-tabs button[data-tab="${name}"]`;
const openAuditTab = async (page: import("@playwright/test").Page) => {
  await page.click(PANEL_TAB("audit"));
};

const auditPanel = ".panel-content .audit-panel";

test.describe("Audit facet — corpus diagnostics", () => {
  test("renders the rollup: headline, totals, rules-by-blast and per-component pivots", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openAuditTab(page);

    await expect(page.locator(auditPanel)).toBeAttached({ timeout: 10_000 });
    await expect(page.locator(`${auditPanel} .audit-headline`)).not.toBeEmpty();

    // Totals: five labelled stats, in the order renderAuditView emits them.
    await expect(page.locator(`${auditPanel} .audit-totals .audit-stat-label`))
      .toHaveText(["Components", "Affected", "Clean", "Defects", "Render"]);

    // test-bench ships components with real findings (atoms/a11y-invalid among them), so both
    // pivots must be populated — the empty-state branches are NOT what we expect here.
    await expect(page.locator(`${auditPanel} .audit-rules .audit-rule`).first()).toBeAttached();
    await expect(page.locator(`${auditPanel} .audit-components .audit-component`).first()).toBeAttached();
    await expect(page.locator(`${auditPanel} .audit-empty`)).toHaveCount(0);

    // The scope boundary is not optional — the count is only honest beside what it excludes.
    await expect(page.locator(`${auditPanel} .audit-scope`)).toHaveAttribute("open", "");

    // It renders as real lists, not formatted source: no Markdown syntax reaches the page.
    const scope = page.locator(`${auditPanel} .audit-scope`);
    await expect(scope.locator(".audit-scope-list[data-scope='covered'] > li").first()).toBeVisible();
    await expect(scope.locator(".audit-scope-list[data-scope='not-covered'] > li").first()).toBeVisible();
    await expect(scope.locator(".audit-scope-note")).toHaveText(/^No findings means/);
    await expect(scope.locator("code").first()).toBeVisible();
    const scopeText = (await scope.innerText()) ?? "";
    expect(scopeText).not.toMatch(/\*\*|^#+ |`/m);
    expect(await scope.locator(".audit-scope-name").first().evaluate(e => getComputedStyle(e).fontWeight)).toBe("600");
  });

  test("shows the loading placeholder while the rollup is in flight", async ({ page }) => {
    // Delay the response so the transient state is observable rather than raced.
    await page.route("**/api/audit", async (route) => {
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 1_500));
      await route.fulfill({ response: res });
    });

    await gotoComponent(page, "atoms/button");
    await openAuditTab(page);

    await expect(page.locator(".panel-content .audit-loading")).toBeAttached({ timeout: 5_000 });
    await expect(page.locator(".panel-content .audit-loading")).toHaveText(/Loading corpus audit/);

    // …and it resolves into the real view rather than sticking.
    await expect(page.locator(`${auditPanel} .audit-headline`)).toBeAttached({ timeout: 10_000 });
    await expect(page.locator(".panel-content .audit-loading")).toHaveCount(0);
  });

  test("a failed fetch renders the error state, not a blank panel", async ({ page }) => {
    await page.route("**/api/audit", (route) => route.fulfill({ status: 500, body: "nope" }));

    await gotoComponent(page, "atoms/button");
    await openAuditTab(page);

    const err = page.locator(".panel-content .audit-error");
    await expect(err).toBeAttached({ timeout: 10_000 });
    await expect(err).toHaveText(/Corpus audit unavailable/);
  });

  // Reopening the tab after an error retries -- which is what the panel's copy promises.
  //
  // This previously asserted the opposite, as a [PD-GAP] pinning the sticky-error defect. The
  // retry is deliberately driven by the TAB EVENT, not by renderAuditFacet: renderPanel runs on
  // every navigation, so retrying on render would hammer a failing endpoint once per component
  // change. The two assertions below are therefore a pair -- reopen retries, navigation does not.
  test("reopening the tab after an error retries the fetch", async ({ page }) => {
    let calls = 0;
    let failing = true;
    await page.route("**/api/audit", async (route) => {
      calls++;
      if (failing) return route.fulfill({ status: 500, body: "nope" });
      return route.fulfill({ response: await route.fetch() });
    });

    await gotoComponent(page, "atoms/button");
    await openAuditTab(page);
    await expect(page.locator(".panel-content .audit-error")).toBeAttached({ timeout: 10_000 });
    expect(calls).toBe(1);

    // Navigating while the failed facet is open must NOT retry -- that is the render storm the
    // sticky state exists to prevent, and it must survive this fix.
    //
    // Must be SPA navigation (a tree link), not page.goto: a full load reinitialises the shell, so
    // auditState starts at `idle` again and refetching is correct there. Only in-app navigation
    // exercises the renderPanel path this assertion is about.
    await page.click('.sidebar-tree a.tree-link[href="/atoms/badge"]');
    await expect(page).toHaveURL(/\/atoms\/badge/);
    await expect(page.locator(".panel-content .audit-error")).toBeAttached();
    expect(calls).toBe(1);

    // Make the endpoint healthy, then leave the tab and come back.
    failing = false;
    await page.click(PANEL_TAB("docs"));
    await expect(page.locator(".panel-content .audit-error")).toHaveCount(0);
    await openAuditTab(page);

    // The deliberate reopen retries, and the real view replaces the error.
    await expect(page.locator(`${auditPanel} .audit-headline`)).toBeAttached({ timeout: 10_000 });
    await expect(page.locator(".panel-content .audit-error")).toHaveCount(0);
    expect(calls).toBe(2);
  });

  test("audit-link navigates to the component (a real href, SPA-intercepted)", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openAuditTab(page);
    await expect(page.locator(`${auditPanel} .audit-headline`)).toBeAttached({ timeout: 10_000 });

    const link = page.locator(`${auditPanel} .audit-components a.audit-link`).first();
    await expect(link).toBeAttached();
    const targetId = (await link.textContent())!.trim();
    // Links navigate, buttons act — this must be a real anchor with a real href.
    await expect(link).toHaveAttribute("href", new RegExp(`^/${targetId.split("/")[0]}/`));

    await link.click();

    await expect(page).toHaveURL(new RegExp(`/${targetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", /.+/);
  });

  test("facet is selection-independent: it survives navigating to another component", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openAuditTab(page);
    await expect(page.locator(`${auditPanel} .audit-headline`)).toBeAttached({ timeout: 10_000 });
    const headline = await page.locator(`${auditPanel} .audit-headline`).textContent();

    // The corpus view shows the whole corpus, never the selection — navigating must not blank it
    // or swap it for the docs pane.
    await page.click('.sidebar-tree a.tree-link[href="/atoms/a11y-invalid"]').catch(async () => {
      await page.goto("/atoms/a11y-invalid");
    });
    await page.waitForSelector("#preview-frame[srcdoc]");

    await expect(page.locator(PANEL_TAB("audit"))).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`${auditPanel} .audit-headline`)).toHaveText(headline!);
  });

  test("an HMR content change while the facet is open refetches the rollup", async ({ page }) => {
    test.setTimeout(60_000);
    let calls = 0;
    // Counts each request and hands it on in one call. Fetching and then fulfilling left a window in
    // which the route could be settled while the fetch was in flight, and the fulfill then threw
    // "Route is already handled" (seen once on CI). The test only counts requests, so it never needs
    // the response in hand.
    await page.route("**/api/audit", (route) => {
      calls++;
      return route.continue();
    });

    await gotoComponent(page, "atoms/button");
    await openAuditTab(page);
    await expect(page.locator(`${auditPanel} .audit-headline`)).toBeAttached({ timeout: 10_000 });
    expect(calls).toBe(1);

    // The freshness hook (main.ts:2399-2402) sits OUTSIDE the `componentId === current?.id` gate,
    // so any content change refreshes an open audit facet.
    const jsonPath = path.join(testBench, "src/patterns/atoms/button/button.json");
    const original = await readFile(jsonPath, "utf8");
    try {
      const mutated = JSON.parse(original);
      mutated.label = `${mutated.label ?? "Button"} audited`;
      await writeFile(jsonPath, JSON.stringify(mutated, null, 2));

      await expect.poll(() => calls, { timeout: 15_000 }).toBeGreaterThan(1);
    } finally {
      await writeFile(jsonPath, original);
      // The restore fires its own watcher event; let it land so it doesn't leak into the next spec.
      await expect
        .poll(async () => page.locator("#preview-frame").getAttribute("srcdoc"), { timeout: 10_000 })
        .not.toContain("audited");
      // The restore also refetches the rollup. End the intercept only once that request's handler has
      // finished, so no handler is still running when the page closes.
      await page.unrouteAll({ behavior: "wait" });
    }
  });
});
