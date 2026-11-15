// The browser tab names the workbench: shell.brand.title (test-bench sets "Test bench"), with the component in front
// on a component route, so tabs and history entries can be told apart. The served page has the brand before any
// script runs; the shell keeps the title in step with every navigation, Back included.

import { test, expect } from "@playwright/test";

test("the served page's title is the brand", async ({ request }) => {
  const html = await (await request.get("/atoms/button")).text();
  expect(html).toContain("<title>Test bench</title>");
});

test("a component route puts the component in front; a folder, and Back to it, the brand alone", async ({ page }) => {
  await page.goto("/atoms");
  await expect(page.locator("#category-overview")).toBeVisible();
  await expect(page).toHaveTitle("Test bench");
  await page.goto("/atoms/button");
  await page.waitForSelector("#preview-frame[srcdoc]");
  await expect(page).toHaveTitle("Button · Test bench");
  // An in-app link (pushState): the title follows it, and Back restores the previous one.
  await page.locator('.sidebar a[href$="/atoms/badge"]').first().click();
  await expect(page).toHaveURL(/\/atoms\/badge$/);
  await expect(page).toHaveTitle("Badge · Test bench");
  await page.goBack();
  await expect(page).toHaveURL(/\/atoms\/button$/);
  await expect(page).toHaveTitle("Button · Test bench");
});
