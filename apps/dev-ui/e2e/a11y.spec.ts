import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Run axe on the shell chrome.
// Excluded from scope:
//   - preview iframes: the documented design system's own a11y concern
//   - .source-body / .console: contain Shiki-rendered tokens or console output;
//     token colors come from a third-party theme and are not authored by the shell
function shellAxe(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page })
    .exclude("#preview-frame")
    .exclude(".gallery-item iframe")
    .exclude(".source-body")
    .exclude(".console")
    .withTags(["wcag2a", "wcag2aa"]);
}

function criticalViolations(results: Awaited<ReturnType<AxeBuilder["analyze"]>>) {
  return results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  );
}

test.describe("accessibility (axe)", () => {
  test("component view: zero serious/critical violations on shell chrome", async ({
    page,
  }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    const results = await shellAxe(page).analyze();
    const violations = criticalViolations(results);

    if (violations.length > 0) {
      // Emit the first violation message to make failures actionable.
      const summary = violations
        .map((v) => `[${v.impact}] ${v.id}: ${v.description}`)
        .join("\n");
      expect.soft(violations, `axe violations:\n${summary}`).toHaveLength(0);
    }
    expect(violations).toHaveLength(0);
  });

  test("folder overview: zero serious/critical violations on shell chrome", async ({
    page,
  }) => {
    await page.goto("/atoms");
    await page.waitForSelector(".gallery");

    const results = await shellAxe(page).analyze();
    expect(criticalViolations(results)).toHaveLength(0);
  });

  test("component view with panel open: zero serious/critical violations", async ({
    page,
  }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");
    // Panel is open by default at 1280px (init sets data-panel-open).
    await expect(page.locator(".panel")).toBeVisible();

    const results = await shellAxe(page).analyze();
    expect(criticalViolations(results)).toHaveLength(0);
  });

  test("component view with panel closed: zero serious/critical violations", async ({
    page,
  }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Close the panel with the toggle button.
    await page.getByLabel("Docs panel", { exact: true }).click();

    // Settle before scanning. The sibling "panel open" test waits on .panel becoming visible;
    // this one scanned immediately, so axe sampled a transient frame — it read the rail labels
    // at an in-flight opacity (contrast 4.15) while the settled value is 0.8 -> 4.91:1, verified
    // on the rendered DOM. Asserting a mid-transition frame is not a meaningful a11y contract.
    // Use the state flag, not .panel visibility: at a wide viewport closing collapses the grid
    // track to 0 but the element keeps box presence, so it still reports as visible (only the
    // narrow-breakpoint case in layout.spec.ts can assert not-visible).
    await expect(page.locator(".main")).not.toHaveAttribute("data-panel-open");
    await page.waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== "running"),
    );

    const results = await shellAxe(page).analyze();
    expect(criticalViolations(results)).toHaveLength(0);
  });
});
