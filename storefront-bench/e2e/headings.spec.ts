// Heading anchors on a storefront page, read off the rendered DOM: every heading of the page's markdown
// carries its id, and the doc layout's table of contents (from page.headings) links to them. Against pd dev
// and the built root alike.
import { expect, test } from "@playwright/test";

test("the setup page's headings carry their anchors, and its table of contents reaches them", async ({ page }) => {
  // Short enough that "Layouts" starts below the fold, so reaching it is a scroll.
  await page.setViewportSize({ width: 800, height: 240 });
  await page.goto("/guides/setup/");

  await expect(page.locator(".doc-body h2")).toHaveText(["Pages", "Layouts"]);
  expect(await page.locator(".doc-body h2").evaluateAll(hs => hs.map(h => h.id))).toEqual(["pages", "layouts"]);
  const toc = page.locator(".doc-toc a");
  await expect(toc).toHaveText(["Pages", "Layouts"]);
  expect(await toc.evaluateAll(as => as.map(a => a.getAttribute("href")))).toEqual(["#pages", "#layouts"]);

  const target = page.locator("h2#layouts");
  const top = () => target.evaluate(h => h.getBoundingClientRect().top);
  expect(await top()).toBeGreaterThan(240);
  await toc.filter({ hasText: "Layouts" }).click();
  await expect(page).toHaveURL(/\/guides\/setup\/#layouts$/);
  // In view: the page scrolled, and the heading is inside the viewport (a fragment scrolls it to the top,
  // which fractional layout can leave a sub-pixel above 0).
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect.poll(top).toBeLessThan(240);
  expect(await top()).toBeGreaterThan(-1);
});
