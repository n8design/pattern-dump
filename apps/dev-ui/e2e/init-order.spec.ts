// Bootstrap sequencing + per-selection cache invalidation.
//
// Two paths with no coverage, both of which the main.ts decomposition is about to disturb.
//
// 1. init() (main.ts:3189) is a strict-ordering bootstrap with a real trap: `storedDockForInit` is
//    snapshotted BEFORE navigation (main.ts:3297) precisely because applyComponent resets the dock
//    to source/hbs, and the stored tab is re-applied afterwards. Reorder those two and reload
//    persistence silently breaks -- with nothing to catch it until now.
//
// 2. The per-selection source caches (renderedHtmlCache / rawRenderedHtml / dataCache / dataRaw) are
//    reset at five sites that are SIMILAR BUT NOT IDENTICAL: applyComponent resets two fields and
//    then populates the data pair from the payload, while swapVariant and the HMR handler reset four
//    and clear the dock bodies. Collapsing them into one shared helper would wipe data that
//    applyComponent just supplied. These tests pin the observable consequence so that change -- when
//    it comes -- has to prove itself.

import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

const dockTab = (name: string) => `#dock-tab-${name}`;

test.describe("bootstrap ordering", () => {
  test("a stored dock tab survives a reload on a component route", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    await page.click(dockTab("console"));
    await expect(page.locator(dockTab("console"))).toHaveAttribute("aria-selected", "true");

    await page.reload();
    await page.waitForSelector("#preview-frame[srcdoc]");

    // If the stored-dock snapshot moved to AFTER navigation, applyComponent's reset to Source would
    // win here and this would read "source".
    await expect(page.locator(dockTab("console"))).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(dockTab("source"))).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#dock-panel-console")).not.toHaveAttribute("hidden", /.*/);
  });

  test("the Diagnostics tab also survives, and still renders its panel", async ({ page }) => {
    await gotoComponent(page, "atoms/a11y-invalid");
    await page.click(dockTab("diagnostics"));
    await expect(page.locator("#dock-panel-diagnostics")).not.toHaveAttribute("hidden", /.*/);

    await page.reload();
    await page.waitForSelector("#preview-frame[srcdoc]");

    await expect(page.locator(dockTab("diagnostics"))).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#dock-panel-diagnostics .diagnostics")).toBeAttached({ timeout: 10_000 });
  });
});

test.describe("per-selection cache invalidation", () => {
  test("HTML dock content changes when navigating to a different component", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.click(dockTab("html"));
    const buttonHtml = await page.locator("#dock-panel-html").innerText();
    expect(buttonHtml.trim().length).toBeGreaterThan(0);

    // organisms/card, not atoms/badge: badge is a BASE-LESS family (synthesized from variants, M6),
    // so its base rendered source is empty and cannot show a content change.
    await page.goto("/organisms/card");
    await page.waitForSelector("#preview-frame[srcdoc]");
    await page.click(dockTab("html"));

    // A stale renderedHtmlCache would show the previous component's markup here.
    await expect.poll(
      async () => (await page.locator("#dock-panel-html").innerText()).trim(),
      { timeout: 10_000 },
    ).not.toBe(buttonHtml.trim());
    // And it is the NEW component's markup, not merely different.
    await expect(page.locator("#dock-panel-html")).toContainText("df-card");
  });

  test("HTML dock content changes when switching variant on one component", async ({ page }) => {
    await gotoComponent(page, "atoms/badge");
    await page.click(dockTab("html"));
    const base = (await page.locator("#dock-panel-html").innerText()).trim();

    // Variant swap goes through swapVariant, a DIFFERENT reset path from navigation.
    const select = page.locator(".variant-select");
    const options = await select.locator("option").evaluateAll(
      (els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean),
    );
    test.skip(options.length === 0, "no variants on atoms/badge");
    // badge's base render is empty (base-less family), so base -> variant is a clear discriminator.

    await select.selectOption(options[0]!);

    await expect.poll(
      async () => (await page.locator("#dock-panel-html").innerText()).trim(),
      { timeout: 10_000 },
    ).not.toBe(base);
  });
});
