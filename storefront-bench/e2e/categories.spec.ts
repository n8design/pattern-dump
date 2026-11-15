// Categories on the rendered page, in pd dev and on the built root: the doc layout lists page.categories by label,
// in the page's order, from storefront.categories in the bench's config (independent of the page's folder).
import { expect, test } from "./fixtures.js";

for (const [route, categories] of [
  ["/guides/setup/", [["guides", "Guides"], ["design-systems", "Design systems"]]],
  ["/articles/plain/", [["design-systems", "Design systems"]]],
] as const) {
  test(`${route} lists its categories by label, in its own order`, async ({ page }) => {
    await page.goto(route);
    const items = page.locator(".doc-categories li");
    await expect(items).toHaveText(categories.map(([, label]) => label));
    expect(await items.evaluateAll(lis => lis.map(li => li.getAttribute("data-key")))).toEqual(categories.map(([key]) => key));
    await expect(page.locator(".doc-categories")).toHaveAttribute("aria-label", "Categories");
  });
}

test("a page with no categories has no list of them, and never the layout's sample", async ({ page }) => {
  await page.goto("/about/");
  await expect(page.locator(".doc-categories")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Sample category");
});
