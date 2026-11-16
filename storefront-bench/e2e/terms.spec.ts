// Tag and category pages on the rendered site, in pd dev and on the built root: a page per tag and per category with a
// published page (the bench's layouts/tag and layouts/category), its pages through the compact view, an index of each
// (layouts/tags, layouts/categories), and an old tag key that forwards to its tag's page.
import { expect, test } from "./fixtures.js";

test("a tag's page: its label as the heading and title, its count, its pages as compact cards", async ({ page }) => {
  await page.goto("/tags/images/");
  await expect(page.locator("h1")).toHaveText("Images");
  await expect(page).toHaveTitle("Images · Storefront bench");
  await expect(page.locator(".term-count")).toHaveText("1 page");
  await expect(page.locator(".term .view-compact .compact-card a")).toHaveText(["A harbour of cable cars"]);
  await expect(page.locator(".term .view-compact .compact-card a")).toHaveAttribute("href", "/articles/harbour/");
});

test("a category's page: its label, its description, its pages", async ({ page }) => {
  await page.goto("/categories/design-systems/");
  await expect(page.locator("h1")).toHaveText("Design systems");
  await expect(page.locator(".page-description")).toHaveText("How a design system is built and kept");
  await expect(page.locator(".term .view-compact .compact-card a")).toHaveText(["Setup", "Plain on purpose"]);
});

test("the tag index: every tag with a page, by label, linked, with its count", async ({ page }) => {
  await page.goto("/tags/");
  await expect(page.locator("h1")).toHaveText("Tags");
  const items = page.locator(".terms-list li");
  await expect(items).toHaveText(["Design (1)", "Images (1)", "Layout (1)"]);
  expect(await page.locator(".terms-list a").evaluateAll(as => as.map(a => a.getAttribute("href")))).toEqual(["/tags/design/", "/tags/images/", "/tags/layout/"]);
  await page.locator(".terms-list a", { hasText: "Layout" }).click();
  await expect(page).toHaveURL(/\/tags\/layout\/$/);
  await expect(page.locator("h1")).toHaveText("Layout");
});

test("the category index lists both categories", async ({ page }) => {
  await page.goto("/categories/");
  await expect(page.locator(".terms-list li")).toHaveText(["Design systems (2)", "Guides (1)"]);
});

test("an old tag key's page forwards to the tag's page", async ({ page }) => {
  await page.goto("/tags/pictures/");
  await expect(page).toHaveURL(/\/tags\/images\/$/);
  await expect(page.locator("h1")).toHaveText("Images");
});

test("a tag no page has has no page", async ({ page }) => {
  const res = await page.goto("/tags/nope/");
  expect(res?.status()).toBe(404);
});
