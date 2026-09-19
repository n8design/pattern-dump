// Routes the tree does not know, PatternLab-style hash links, and views that fail to load. Each must
// say what happened in the Stage instead of leaving it empty (0 × 0, no message).

import { test, expect } from "@playwright/test";

test.describe("unknown routes", () => {
  test("a PatternLab-style hash link opens the component at its real route", async ({ page }) => {
    await page.goto("/#/atoms/button");
    await expect(page).toHaveURL(/\/atoms\/button$/);
    await page.waitForFunction(() =>
      !!(document.getElementById("preview-frame") as HTMLIFrameElement | null)
        ?.contentDocument?.querySelector("body[data-component-id='atoms/button']"));
  });

  test("an unknown component says so and links the closest match", async ({ page }) => {
    await page.goto("/atoms/buton");
    const message = page.locator(".stage-message");
    await expect(message).toContainText("No component or folder “atoms/buton”.");
    const link = message.locator('a[href="/atoms/button"]');
    await expect(link).toBeVisible();
    await expect(page.locator("#single-preview")).toBeHidden();

    // The suggestion is a real link: following it opens the component.
    await link.click();
    await expect(page).toHaveURL(/\/atoms\/button$/);
    await expect(page.locator("#single-preview")).toBeVisible();
  });

  test("the same name in another folder is suggested", async ({ page }) => {
    await page.goto("/molecules/button");
    await expect(page.locator('.stage-message a[href="/atoms/button"]')).toBeVisible();
  });

  test("a known folder still opens its folder page", async ({ page }) => {
    await page.goto("/atoms");
    await expect(page.locator("#category-overview .gallery")).toBeVisible();
    await expect(page.locator(".stage-message")).toHaveCount(0);
  });

  test("a component that fails to load says so in the Stage", async ({ page }) => {
    await page.route("**/api/component/atoms/button*", route => route.fulfill({ status: 500, body: "{}" }));
    await page.goto("/atoms/button");
    await expect(page.locator(".stage-message")).toContainText("Could not load “atoms/button”: HTTP 500");
  });
});
