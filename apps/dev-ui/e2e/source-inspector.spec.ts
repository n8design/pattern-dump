import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

test.describe("source inspector — Source tab facets", () => {
  test("atoms/button shows Data and Schema facets in the Source tab", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Source primary tab is always visible.
    await expect(page.locator("#dock-tab-source")).not.toHaveAttribute("hidden");

    // Both facet buttons exist and are not hidden (button has .json + .schema.json).
    await expect(page.locator("#dock-facet-data")).not.toHaveAttribute("hidden");
    await expect(page.locator("#dock-facet-schema")).not.toHaveAttribute("hidden");
  });

  test("atoms/icon (no json, no schema) shows neither Data nor Schema facet", async ({ page }) => {
    await gotoComponent(page, "atoms/icon");

    // Source primary tab still visible.
    await expect(page.locator("#dock-tab-source")).not.toHaveAttribute("hidden");

    // Facets hidden — icon has no data files.
    await expect(page.locator("#dock-facet-data")).toHaveAttribute("hidden", "");
    await expect(page.locator("#dock-facet-schema")).toHaveAttribute("hidden", "");
  });

  test("Data facet shows Shiki-highlighted default data", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Source tab is active by default; click the Data facet.
    await page.click("#dock-facet-data");

    const panel = page.locator("#dock-panel-data");
    await expect(panel).not.toHaveAttribute("hidden");
    await expect(panel.locator("pre")).toBeAttached();

    // Default data string from button.json.
    await expect(panel.locator(".source-body")).toContainText("Action");
  });

  test("Schema facet shows Shiki-highlighted schema content", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    await page.click("#dock-facet-schema");

    const panel = page.locator("#dock-panel-schema");
    await expect(panel).not.toHaveAttribute("hidden");
    await expect(panel.locator("pre")).toBeAttached();

    // A known string from button.schema.json.
    await expect(panel.locator(".source-body")).toContainText("Button");
  });

  test("variant switch updates Data facet content; Schema facet stays unchanged", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");

    // Switch to Data facet — default data shows "Action".
    await page.click("#dock-facet-data");
    await expect(page.locator("#dock-panel-data .source-body")).toContainText("Action");

    // Select the secondary variant.
    await page.selectOption(".variant-select", "secondary");

    // Data facet updates to the secondary variant data ("Cancel").
    await expect(page.locator("#dock-panel-data .source-body")).toContainText("Cancel");

    // Schema is component-level — unchanged.
    await page.click("#dock-facet-schema");
    await expect(page.locator("#dock-panel-schema .source-body")).toContainText("Button");
  });

  test("Copy on Data facet writes raw JSON to clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoComponent(page, "atoms/button");

    await page.click("#dock-facet-data");
    await expect(page.locator("#dock-panel-data .source-body")).toContainText("Action");

    await page.click(".dock-copy-btn");
    await expect(page.locator(".dock-copy-btn")).toHaveText("Copied!");

    const clipText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipText).toContain("Action");
    expect(clipText).not.toContain("<");
  });

  test("Copy on Schema facet writes raw schema JSON to clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoComponent(page, "atoms/button");

    await page.click("#dock-facet-schema");
    await expect(page.locator("#dock-panel-schema .source-body")).toContainText("Button");

    await page.click(".dock-copy-btn");
    await expect(page.locator(".dock-copy-btn")).toHaveText("Copied!");

    const clipText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipText).toContain("$schema");
    expect(clipText).not.toContain("<");
  });
});
