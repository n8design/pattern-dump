import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

test.describe("variants overview — M4.7", () => {
  test("component with variants has an 'All variants' option in the dropdown", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    const select = page.locator(".variant-select");
    await expect(select).toBeVisible();

    // "All variants" option must be present
    const allOpt = select.locator("option[value='__all__']");
    await expect(allOpt).toHaveCount(1);
    await expect(allOpt).toHaveText("All variants");
  });

  test("component without variants has no dropdown (no 'All variants' reachable)", async ({ page }) => {
    // atoms/icon has no named variants — variant-bar is hidden entirely
    await gotoComponent(page, "atoms/icon");
    await expect(page.locator(".variant-bar")).not.toBeVisible();
  });

  test("selecting 'All variants' shows the gallery with default + N named figures", async ({ page }) => {
    // atoms/button has disabled + secondary → 3 figures total (default + 2)
    await gotoComponent(page, "atoms/button");

    await page.selectOption(".variant-select", "__all__");

    // Gallery visible; single preview hidden
    await expect(page.locator("#variants-gallery")).toBeVisible();
    await expect(page.locator("#single-preview")).not.toBeVisible();

    // Three gallery-item figures
    const figures = page.locator("#variants-gallery .gallery-item");
    await expect(figures).toHaveCount(3);

    // Labels (h2.gallery-label): default uses component title; named carry title — variantName.
    await expect(figures.nth(0).locator("h2.gallery-label")).toContainText("Button");
    await expect(figures.nth(1).locator("h2.gallery-label")).toContainText("disabled");
    await expect(figures.nth(2).locator("h2.gallery-label")).toContainText("secondary");
  });

  test("each gallery figure has a srcdoc iframe", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");

    const figures = page.locator("#variants-gallery .gallery-item");
    await expect(figures).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const srcdoc = await figures.nth(i).locator("iframe").getAttribute("srcdoc");
      expect(srcdoc).toBeTruthy();
    }
  });

  test("selecting 'All variants' sets the dropdown to 'All variants'", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");
    await expect(page.locator(".variant-select")).toHaveValue("__all__");
  });

  test("selecting a single variant from gallery mode restores the single preview", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Enter gallery mode
    await page.selectOption(".variant-select", "__all__");
    await expect(page.locator("#variants-gallery")).toBeVisible();

    // Select a named variant to return to single view
    await page.selectOption(".variant-select", "disabled");

    await expect(page.locator("#single-preview")).toBeVisible();
    await expect(page.locator("#preview-frame")).toBeVisible();
    await expect(page.locator("#variants-gallery")).not.toBeVisible();
    await expect(page.locator(".variant-select")).toHaveValue("disabled");
  });

  test("selecting 'default' from gallery mode restores the single preview", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");
    await page.selectOption(".variant-select", "");

    await expect(page.locator("#single-preview")).toBeVisible();
    await expect(page.locator("#variants-gallery")).not.toBeVisible();
    await expect(page.locator(".variant-select")).toHaveValue("");
  });

  test("deep-link to /:id/variants opens gallery and sets dropdown to 'All variants'", async ({ page }) => {
    await page.goto("/atoms/button/variants");
    await expect(page.locator("#variants-gallery")).toBeVisible({ timeout: 5000 });

    // Three figures
    await expect(page.locator("#variants-gallery .gallery-item")).toHaveCount(3);

    // Dropdown reflects the active view
    await expect(page.locator(".variant-select")).toHaveValue("__all__");

    // URL is as expected
    expect(page.url()).toContain("/atoms/button/variants");
  });

  test("navigating to a no-variants component from gallery clears the gallery", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");
    await expect(page.locator("#variants-gallery")).toBeVisible();

    // Navigate to icon (no variants)
    await page.locator(`a.tree-link[href="/atoms/icon"]`).click();
    await page.waitForSelector("#preview-frame[srcdoc]");

    await expect(page.locator("#variants-gallery")).not.toBeVisible();
    await expect(page.locator("#single-preview")).toBeVisible();
    await expect(page.locator(".variant-bar")).not.toBeVisible();
  });

  test("dock shows component source in gallery mode", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");

    // Source tab still active with HBS content
    await expect(page.locator("#dock-tab-source")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#dock-panel-hbs")).toBeVisible();
  });

  test("gallery label is an <a> inside <h2> and sits above the iframe", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");

    const figures = page.locator("#variants-gallery .gallery-item");
    const firstFig = figures.nth(0);

    // h2 contains a link
    const h2 = firstFig.locator("h2.gallery-label");
    await expect(h2).toBeVisible();
    const link = h2.locator("a.gallery-label-link");
    await expect(link).toBeVisible();

    // h2 appears before iframe in the DOM
    const h2Box = await h2.boundingBox();
    const iframeBox = await firstFig.locator("iframe").boundingBox();
    expect(h2Box).not.toBeNull();
    expect(iframeBox).not.toBeNull();
    expect(h2Box!.y + h2Box!.height).toBeLessThanOrEqual(iframeBox!.y + 5);
  });

  test("clicking default-variant label navigates to the component dedicated page", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");

    const figures = page.locator("#variants-gallery .gallery-item");
    const defaultLink = figures.nth(0).locator("a.gallery-label-link");

    await defaultLink.click();

    // Single preview restored, URL is the bare component path
    await page.waitForSelector("#preview-frame[srcdoc]");
    await expect(page.locator("#single-preview")).toBeVisible();
    expect(page.url()).toMatch(/\/atoms\/button$/);
  });

  test("clicking named-variant label navigates with #variantName and pre-selects the variant", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");

    const figures = page.locator("#variants-gallery .gallery-item");
    const disabledLink = figures.nth(1).locator("a.gallery-label-link");

    await disabledLink.click();

    // Single preview restored, URL carries #disabled (variants use hash routing)
    await page.waitForSelector("#preview-frame[srcdoc]");
    await expect(page.locator("#single-preview")).toBeVisible();
    expect(page.url()).toContain("#disabled");

    // Variant select reflects the chosen variant
    await expect(page.locator(".variant-select")).toHaveValue("disabled");
  });

  test("deep-link with #variantName pre-selects the variant on initial load", async ({ page }) => {
    await page.goto("/atoms/button#secondary");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await expect(page.locator("#single-preview")).toBeVisible();
    await expect(page.locator(".variant-select")).toHaveValue("secondary");
  });
});
