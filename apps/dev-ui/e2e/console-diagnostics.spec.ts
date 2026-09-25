import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

async function openDiagnosticsTab(page: import("@playwright/test").Page) {
  await page.click("[data-tab='diagnostics']");
  await expect(page.locator("#dock-panel-diagnostics")).not.toHaveAttribute("hidden");
}

async function openConsoleTab(page: import("@playwright/test").Page) {
  await page.click("[data-tab='console']");
  await expect(page.locator("#dock-panel-console")).not.toHaveAttribute("hidden");
}

const diag = (selector = "") =>
  `#dock-panel-diagnostics .diagnostics${selector}`;

const cons = (selector = "") =>
  `#dock-panel-console .console${selector}`;

test.describe("Diagnostics tab — per-render diagnostics panel (M4.9 finalise)", () => {
  test("broken template shows RENDER_ERROR item in the Diagnostics tab DOM", async ({ page }) => {
    await gotoComponent(page, "atoms/broken-template");
    await openDiagnosticsTab(page);

    // Must contain a rendered list item with RENDER_ERROR under Render/Template category.
    const errorItem = page.locator(diag(" li[data-kind='RENDER_ERROR']"));
    await expect(errorItem).toBeAttached();
    // Severity word renders as a bold "Error" label (its own .diag-sev element, brackets dropped).
    await expect(errorItem.locator(".diag-sev")).toHaveText("Error");
  });

  test("RENDER_ERROR item has severity=error", async ({ page }) => {
    await gotoComponent(page, "atoms/broken-template");
    await openDiagnosticsTab(page);
    await expect(page.locator(diag(" li[data-severity='error']"))).toBeAttached();
  });

  test("schema-guard with missing required field shows UNFILLED_REQUIRED in Diagnostics tab DOM", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/schema-guard");
    await openDiagnosticsTab(page);

    const unfilledItem = page.locator(diag(" li[data-kind='UNFILLED_REQUIRED']"));
    await expect(unfilledItem).toBeAttached();
    await expect(unfilledItem).toContainText("label");
  });

  test("UNFILLED_REQUIRED has severity=error (the silent-blank guard)", async ({ page }) => {
    await gotoComponent(page, "atoms/schema-guard");
    await openDiagnosticsTab(page);
    await expect(
      page.locator(diag(" li[data-kind='UNFILLED_REQUIRED']"))
    ).toHaveAttribute("data-severity", "error");
  });

  test("a component .json that does not parse shows DATA_INVALID, and the component still renders", async ({ page }) => {
    await gotoComponent(page, "atoms/data-invalid");
    await openDiagnosticsTab(page);

    const item = page.locator(diag(" li[data-kind='DATA_INVALID']"));
    await expect(item).toBeAttached();
    await expect(item).toHaveAttribute("data-severity", "error");
    await expect(item).toContainText("data-invalid.json");
    await expect(page.frameLocator("#preview-frame").locator(".tb-data-invalid")).toHaveText("label: []");
  });

  test("clean component reads 'No issues found' — the explicit all-clear", async ({ page }) => {
    // atoms/button default render: schema present, all required fields filled by default data.
    await gotoComponent(page, "atoms/button");
    await openDiagnosticsTab(page);

    await expect(page.locator(diag())).toContainText("No issues found");
    await expect(page.locator(diag(" li"))).toHaveCount(0);
  });

  test("severity ordering within Schema/Data <details> group — errors before warnings", async ({
    page,
  }) => {
    // schema-guard produces UNFILLED_REQUIRED (error) for "label" AND
    // SHAPE_MISMATCH (warning) for "count" (default data has count:"not-a-number").
    await gotoComponent(page, "atoms/schema-guard");
    await openDiagnosticsTab(page);

    // Find the Schema/Data details group.
    const schemaGroup = page.locator(diag(" details")).filter({
      has: page.locator("summary").filter({ hasText: "Schema/Data" }),
    });
    await expect(schemaGroup).toBeAttached();

    const items = schemaGroup.locator("li");
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // First item must be error, last must not be error (warning comes after).
    await expect(items.nth(0)).toHaveAttribute("data-severity", "error");
    const lastSeverity = await items.nth(count - 1).getAttribute("data-severity");
    expect(lastSeverity).toBe("warning");
  });

  test("navigating between components replaces Diagnostics — no carry-over", async ({ page }) => {
    await gotoComponent(page, "atoms/broken-template");
    await openDiagnosticsTab(page);
    await expect(page.locator(diag(" li[data-kind='RENDER_ERROR']"))).toBeAttached();

    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");
    // Wait for the preview iframe to finish loading (CSS resources) so the axe scan
    // triggered by the dock-restore runs on a complete document, not a mid-load one.
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      return f?.contentDocument?.readyState === "complete";
    }, { timeout: 10000 });
    // Re-open the diagnostics tab explicitly: this supersedes any pending auto-restore scan
    // and starts a fresh scan on the fully-loaded iframe (same path as the :60 test that passes).
    await openDiagnosticsTab(page);
    // Diagnostics tab must now show the clean component's state — no carry-over from broken-template.
    await expect(page.locator(diag())).toContainText("No issues found");
    await expect(page.locator(diag(" li[data-kind='RENDER_ERROR']"))).toHaveCount(0);
  });

  test("Back/Forward re-fills Diagnostics — not stale, not blank", async ({ page }) => {
    await gotoComponent(page, "atoms/schema-guard");
    await openDiagnosticsTab(page);
    await expect(page.locator(diag(" li[data-kind='UNFILLED_REQUIRED']"))).toBeAttached();

    await page.click('a[href="/atoms/button"]');
    await page.waitForSelector("#preview-frame[srcdoc]");
    await expect(page.locator(diag())).toContainText("No issues found");

    await page.goBack();
    await page.waitForSelector("#preview-frame[srcdoc]");
    await expect(page.locator(diag())).not.toContainText("No issues found");
    await expect(page.locator(diag(" li[data-kind='UNFILLED_REQUIRED']"))).toBeAttached();
  });

  test("Diagnostics panel carries no lifecycle noise — no HMR lines", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openDiagnosticsTab(page);

    await expect(page.locator(diag())).not.toContainText("HMR connected");
    await expect(page.locator(diag())).not.toContainText("HMR disconnected");
    await expect(page.locator(diag())).not.toContainText("content-swap");
  });

  test("render failure returns 200 — RENDER_ERROR diagnostic in payload", async ({ page }) => {
    const response = await page.request.get("/api/component/atoms/broken-template");
    expect(response.status()).toBe(200);
    const body = await response.json() as { diagnostics: Array<{ kind: string }> };
    expect(body.diagnostics.some((d) => d.kind === "RENDER_ERROR")).toBe(true);
  });

  // ---- Categorized rollup tests ----

  test("HTML validation: html-invalid shows HTML_INVALID item under HTML validation category", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/html-invalid");
    await openDiagnosticsTab(page);

    // Must have a <details> with "HTML validation" in its summary.
    const htmlGroup = page.locator(diag(" details")).filter({
      has: page.locator("summary").filter({ hasText: "HTML validation" }),
    });
    await expect(htmlGroup).toBeAttached();

    const htmlItem = htmlGroup.locator("li[data-kind='HTML_INVALID']");
    await expect(htmlItem).toBeAttached();
    await expect(htmlItem).toHaveAttribute("data-severity", "warning");
  });

  test("clean fragment produces no HTML validation findings (fragment-scoped)", async ({ page }) => {
    // atoms/button renders a clean <button> — no block-in-button.
    await gotoComponent(page, "atoms/button");
    await openDiagnosticsTab(page);

    // No HTML validation <details> group should be present.
    const htmlGroup = page.locator(diag(" details")).filter({
      has: page.locator("summary").filter({ hasText: "HTML validation" }),
    });
    await expect(htmlGroup).toHaveCount(0);
  });

  test("empty categories render no <details> (empty groups hidden)", async ({ page }) => {
    // schema-guard has Schema/Data findings but no HTML findings and no Render/Template.
    await gotoComponent(page, "atoms/schema-guard");
    await openDiagnosticsTab(page);

    const allDetails = page.locator(diag(" details"));
    const count = await allDetails.count();
    // Only Schema/Data group should be present (no HTML validation, no Render/Template).
    expect(count).toBe(1);
    await expect(allDetails.first().locator("summary")).toContainText("Schema/Data");
  });

  test("accordion uses shared name=pd-diagnostics (exclusive, default closed)", async ({ page }) => {
    await gotoComponent(page, "atoms/html-invalid");
    await openDiagnosticsTab(page);

    // html-invalid: HTML_INVALID warning. It also has valid markup outside the button,
    // so may only have HTML validation group. Confirm the details has name="pd-diagnostics".
    const details = page.locator(diag(" details")).first();
    await expect(details).toHaveAttribute("name", "pd-diagnostics");
    // Default closed: open attribute should not be present on load.
    await expect(details).not.toHaveAttribute("open");
  });

  // ---- A11y category tests (M4.10) ----

  test("a11y-invalid: A11y category appears in Diagnostics tab with A11Y items", async ({ page }) => {
    await gotoComponent(page, "atoms/a11y-invalid");
    await openDiagnosticsTab(page);

    const a11yGroup = page.locator(diag(" details")).filter({
      has: page.locator("summary").filter({ hasText: "A11y" }),
    });
    await expect(a11yGroup).toBeAttached();

    const a11yItem = a11yGroup.locator("li[data-kind='A11Y']");
    await expect(a11yItem.first()).toBeAttached();
  });

  test("a11y-invalid: image-alt finding has ruleId, target, and docs link", async ({ page }) => {
    await gotoComponent(page, "atoms/a11y-invalid");
    await openDiagnosticsTab(page);

    const imageAltItem = page.locator(diag(" li[data-rule-id='image-alt']"));
    await expect(imageAltItem).toBeAttached();
    // Must contain a [docs] link to Deque docs.
    await expect(imageAltItem.locator("a[href*='image-alt']")).toBeAttached();
    // Must show the rule name in a span.
    await expect(imageAltItem.locator(".pd-a11y-rule")).toContainText("image-alt");
  });

  test("a11y-invalid: label finding appears for unlabelled input", async ({ page }) => {
    await gotoComponent(page, "atoms/a11y-invalid");
    await openDiagnosticsTab(page);

    const labelItem = page.locator(diag(" li[data-rule-id='label']"));
    await expect(labelItem).toBeAttached();
  });

  test("a11y-invalid: A11Y items have error severity", async ({ page }) => {
    await gotoComponent(page, "atoms/a11y-invalid");
    await openDiagnosticsTab(page);

    const errorItems = page.locator(diag(" li[data-kind='A11Y'][data-severity='error']"));
    await expect(errorItems.first()).toBeAttached();
  });

  test("clean component shows no A11y group", async ({ page }) => {
    // atoms/button: text-bearing button — no a11y violations.
    await gotoComponent(page, "atoms/button");
    await openDiagnosticsTab(page);

    const a11yGroup = page.locator(diag(" details")).filter({
      has: page.locator("summary").filter({ hasText: "A11y" }),
    });
    await expect(a11yGroup).toHaveCount(0);
  });

  test("a11y diagnostics are synchronous — present on initial page load", async ({ page }) => {
    // A11y findings must be in the API response (no separate async channel).
    const response = await page.request.get("/api/component/atoms/a11y-invalid");
    expect(response.status()).toBe(200);
    const body = await response.json() as { diagnostics: Array<{ kind: string; ruleId?: string }> };
    const a11yDiags = body.diagnostics.filter((d) => d.kind === "A11Y");
    expect(a11yDiags.length).toBeGreaterThan(0);
    expect(a11yDiags.some((d) => d.ruleId === "image-alt")).toBe(true);
  });

  // ---- Console tab tests ----

  test("Console tab shows HMR connected message — lifecycle lines restored", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openConsoleTab(page);

    await expect(page.locator(cons())).toContainText("HMR connected");
  });

  test("Console log persists across navigation — not cleared per component", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openConsoleTab(page);
    // Confirm HMR connected is visible after initial load.
    await expect(page.locator(cons())).toContainText("HMR connected");

    // Navigate to another component.
    await page.goto("/atoms/schema-guard");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Switch to console tab and confirm the message is still there (log persists).
    await openConsoleTab(page);
    await expect(page.locator(cons())).toContainText("HMR connected");
  });

  test("HMR lines appear in Console, not in Diagnostics", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openConsoleTab(page);
    await expect(page.locator(cons())).toContainText("HMR connected");

    // Diagnostics panel must NOT contain the HMR text.
    await openDiagnosticsTab(page);
    await expect(page.locator(diag())).not.toContainText("HMR connected");
  });
});
