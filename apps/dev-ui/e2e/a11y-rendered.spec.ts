import { test, expect } from "@playwright/test";
import { gotoComponent, selectTheme } from "./helpers.js";

async function openDiagnosticsTab(page: import("@playwright/test").Page) {
  await page.click("[data-tab='diagnostics']");
  await expect(page.locator("#dock-panel-diagnostics")).not.toHaveAttribute("hidden");
}

// Wait for the scan to complete — pending note disappears and panel is settled.
async function waitForScan(page: import("@playwright/test").Page) {
  await expect(page.locator(".pd-a11y-pending")).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Arm a latch that records `.pd-a11y-pending` ever being ADDED to the DOM.
 *
 * The pending note is created SYNCHRONOUSLY by the "Run rendered checks" click handler
 * (main.ts:758 -> refreshDiagnostics) and removed when the async axe scan completes. Polling for
 * it after the click is therefore a race the test loses whenever the scan finishes first — a
 * measured ~1-in-10 failure, and one that gets likelier as the scan gets faster.
 *
 * A MutationObserver installed BEFORE the click cannot miss it: it inspects the addedNodes of each
 * mutation record, so the appearance is recorded even if the element is removed in the same task.
 * This strengthens the assertion rather than relaxing it — the test now proves the pending state
 * actually fired, instead of hoping to catch it mid-flight.
 */
async function armPendingLatch(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const w = window as Window & { __pdPendingSeen?: boolean; __pdPendingObs?: MutationObserver };
    w.__pdPendingSeen = false;
    w.__pdPendingObs?.disconnect();
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (n instanceof HTMLElement && n.classList.contains("pd-a11y-pending")) {
            w.__pdPendingSeen = true;
          }
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    w.__pdPendingObs = obs;
  });
}

const pendingWasSeen = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as Window & { __pdPendingSeen?: boolean }).__pdPendingSeen === true);

const diag = (selector = "") =>
  `#dock-panel-diagnostics .diagnostics${selector}`;

test.describe("M4.11 — rendered a11y tier (axe in iframe)", () => {
  test("contrast-fail: Diagnostics tab shows a color-contrast finding after scan", async ({ page }) => {
    await gotoComponent(page, "atoms/contrast-fail");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    const contrastItem = page.locator(diag(" li[data-rule-id='color-contrast']"));
    await expect(contrastItem).toBeAttached();
    await expect(contrastItem).toHaveAttribute("data-severity", "error");
  });

  test("contrast-fail: color-contrast finding shows swatches and ratio text", async ({ page }) => {
    await gotoComponent(page, "atoms/contrast-fail");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    const swatches = page.locator(diag(" li[data-rule-id='color-contrast'] .pd-contrast-swatches"));
    await expect(swatches).toBeAttached();

    // Should contain two swatch spans and one ratio span.
    await expect(swatches.locator(".pd-swatch")).toHaveCount(2);

    const ratio = swatches.locator(".pd-contrast-ratio");
    await expect(ratio).toBeAttached();
    // Spike measured 1.91:1; tolerate minor rounding differences.
    await expect(ratio).toContainText(":1");
    await expect(ratio).toContainText("needs");
  });

  test("structurally-clean component: 'No issues found' is absent while scan is in flight", async ({ page }) => {
    // Hold the scan in flight. The pending note lives only as long as the scan (about 60ms), and
    // page.click() can return after it is already gone, so the state under test would otherwise be
    // asserted after the fact: measured, the test failed about half the time when run on its own.
    // The scan loads axe into the fresh preview document, so holding that request holds the scan.
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let axeRequested = false;
    await page.route("**/_pd/axe-core.js", async route => {
      axeRequested = true;
      await held;
      await route.continue();
    });

    await gotoComponent(page, "atoms/contrast-fail");
    await page.click("[data-tab='diagnostics']");
    await expect(page.locator("#dock-panel-diagnostics")).not.toHaveAttribute("hidden");

    // While the pending note is visible, the all-clear must be absent.
    const pending = page.locator(".pd-a11y-pending");
    const allClear = page.locator(diag(" p")).filter({ hasText: "No issues found" });

    await expect(pending).toBeAttached({ timeout: 3_000 });
    await expect(allClear).toHaveCount(0);
    // The hold is what keeps the scan in flight here; without the request it would hold nothing.
    await expect.poll(() => axeRequested).toBe(true);

    // Let the scan finish.
    release();
    await waitForScan(page);
    await page.unrouteAll({ behavior: "wait" });
  });

  test("tier-one structural findings are unaffected on a11y-invalid", async ({ page }) => {
    await gotoComponent(page, "atoms/a11y-invalid");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    // Structural A11y findings from M4.10 must still be present.
    const a11yItems = page.locator(diag(" li[data-kind='A11Y']"));
    await expect(a11yItems).not.toHaveCount(0);
  });

  test("theme switch while Diagnostics active triggers auto-rescan", async ({ page }) => {
    await gotoComponent(page, "atoms/contrast-fail");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    // Confirm initial scan found a contrast finding.
    await expect(page.locator(diag(" li[data-rule-id='color-contrast']"))).toBeAttached();

    // The theme picker is radio buttons inside <details> (it was a <select class="theme-select">
    // until it was rebuilt; see interaction.spec.ts:8). This test located the DEAD `.theme-select`,
    // found zero <option>s, skipped its whole body via `if (options.length > 1)`, and passed on the
    // trailing structural assertion alone — never switching a theme, never asserting a rescan.
    // It is unconditional now: a missing radio fails rather than silently skipping.
    // Arm BEFORE the switch. `.pd-a11y-pending` is created synchronously by the picker's change
    // handler (main.ts:345-350) and removed when the async scan resolves, so polling for it after
    // the fact is a race — the same one armPendingLatch() was written for.
    await armPendingLatch(page);

    // selectTheme throws if the radio is absent, so a dead locator can no longer no-op.
    await selectTheme(page, "brand-blue");

    // The switch really happened.
    await expect(page.locator(".theme-picker-current-name")).toHaveText("brand-blue");

    // THE assertion this test is named for: the theme change invalidated the rendered-a11y results
    // and kicked a fresh scan. Nothing else in the app produces this pending state, so it is the
    // discriminator — the contrast finding below was already present from the initial scan and
    // would survive a handler that did nothing.
    expect(await pendingWasSeen(page)).toBe(true);

    await waitForScan(page);

    // The rescan produced results, rather than leaving the panel empty.
    await expect(page.locator(diag(" li[data-rule-id='color-contrast']"))).toBeAttached();
  });

  test("manual 'Run rendered checks' button triggers a re-scan", async ({ page }) => {
    await gotoComponent(page, "atoms/contrast-fail");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    // Arm the latch BEFORE clicking — see armPendingLatch. The pending note can come and go
    // faster than a poll can observe it.
    await armPendingLatch(page);
    await page.click(".pd-run-rendered");

    // The manual button must actually arm a re-scan, which the pending state is the evidence of.
    await expect.poll(() => pendingWasSeen(page), { timeout: 5_000 }).toBe(true);
    await waitForScan(page);

    // Contrast finding is present after re-scan.
    await expect(page.locator(diag(" li[data-rule-id='color-contrast']"))).toBeAttached();
  });

  test("navigating to a clean component then back: rendered findings reset correctly", async ({ page }) => {
    await gotoComponent(page, "atoms/contrast-fail");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    // Navigate away to a clean component (button has no contrast failure).
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");
    // Re-open diagnostics on the clean component.
    await openDiagnosticsTab(page);
    await waitForScan(page);

    // The contrast-fail finding must not bleed over.
    await expect(page.locator(diag(" li[data-rule-id='color-contrast']"))).toHaveCount(0);
  });
});

test.describe("M4.11 — needs-review (axe incomplete) tier", () => {
  test("white-noise: needs-review entry appears with color-contrast rule", async ({ page }) => {
    await gotoComponent(page, "atoms/white-noise");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    const reviewItem = page.locator(diag(" li[data-needs-review='true'][data-rule-id='color-contrast']"));
    await expect(reviewItem).toBeAttached();
    // Entry must carry the axe reason string (not empty).
    await expect(reviewItem).not.toBeEmpty();
    // Needs-review items must NOT carry a confirmed-severity badge (D3a).
    await expect(reviewItem).not.toContainText("[error]");
    await expect(reviewItem).not.toContainText("[warning]");
  });

  test("white-noise: 'No issues found' absent when only needs-review items present", async ({ page }) => {
    await gotoComponent(page, "atoms/white-noise");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    // No confirmed violations — but needs-review exists, so all-clear must be absent.
    await expect(page.locator(diag(" p")).filter({ hasText: "No issues found" })).toHaveCount(0);
    // The nested review accordion must be present (a <summary> inside a nameless <details>).
    await expect(page.locator(diag(" .pd-a11y-review-header"))).toBeAttached();
    // Zero confirmed → review accordion defaults open so content is immediately visible.
    await expect(page.locator(diag(" details:not([name])"))).toHaveAttribute("open");
  });

  test("white-noise: headline count reflects confirmed only (zero · 1 to review)", async ({ page }) => {
    await gotoComponent(page, "atoms/white-noise");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    // Summary must use the split format — confirmed count (0) then review count.
    const summary = page.locator(diag(" details[name='pd-diagnostics'] summary")).filter({ hasText: "A11y" });
    await expect(summary).toBeAttached();
    // Must contain "to review" (split format), not just a bare "(1)" which would wrongly count review as confirmed.
    await expect(summary).toContainText("to review");
    // Primary number must be 0 confirmed (white-noise has no confirmed violations).
    await expect(summary).toContainText("0");
  });

  test("white-noise: contrast swatches present (axe resolved fg/bg even in incomplete)", async ({ page }) => {
    await gotoComponent(page, "atoms/white-noise");
    await openDiagnosticsTab(page);
    await waitForScan(page);

    // Gate confirmed fg=#ffffff, bg=#ffffff are present in the incomplete data.
    const swatches = page.locator(diag(" li[data-needs-review='true'] .pd-contrast-swatches"));
    await expect(swatches).toBeAttached();
    await expect(swatches.locator(".pd-swatch")).toHaveCount(2);
  });
});
