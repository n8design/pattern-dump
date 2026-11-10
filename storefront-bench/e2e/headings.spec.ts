// Heading anchors on a storefront page, read off the rendered DOM: every heading of the page's markdown
// carries its id, the doc layout's table of contents (from page.headings) links to them, and a heading whose
// anchor the layout already has as an id ("Main", against <main id="main">) gets the next free suffix.
// Against pd dev and the built root alike.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

// Short enough that every heading but the first starts below the fold, so reaching one is a scroll.
const HEIGHT = 240;

/** From the top of the page, the table-of-contents link to `anchor` scrolls its heading into view. */
async function reaches(page: Page, text: string, anchor: string): Promise<void> {
  await page.goto("/guides/setup/");
  const target = page.locator(`.doc-body h2[id="${anchor}"]`);
  const top = () => target.evaluate(h => h.getBoundingClientRect().top);
  expect(await top()).toBeGreaterThan(HEIGHT);
  await page.locator(".doc-toc a").filter({ hasText: text }).click();
  await expect(page).toHaveURL(new RegExp(`/guides/setup/#${anchor}$`));
  // In view: the page scrolled, and the heading is inside the viewport (a fragment scrolls it to the top,
  // which fractional layout can leave a sub-pixel above 0).
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect.poll(top).toBeLessThan(HEIGHT);
  expect(await top()).toBeGreaterThan(-1);
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 800, height: HEIGHT }); });

test("the setup page's headings carry their anchors, and its table of contents reaches them", async ({ page }) => {
  await page.goto("/guides/setup/");
  await expect(page.locator(".doc-body h2")).toHaveText(["Pages", "Layouts", "Main"]);
  expect(await page.locator(".doc-body h2").evaluateAll(hs => hs.map(h => h.id))).toEqual(["pages", "layouts", "main-1"]);
  const toc = page.locator(".doc-toc a");
  await expect(toc).toHaveText(["Pages", "Layouts", "Main"]);
  expect(await toc.evaluateAll(as => as.map(a => a.getAttribute("href")))).toEqual(["#pages", "#layouts", "#main-1"]);
  await reaches(page, "Layouts", "layouts");
});

test("a heading whose anchor the layout has is suffixed, and every id on the page is unique", async ({ page }) => {
  await page.goto("/guides/setup/");
  await expect(page.locator("main#main")).toHaveCount(1);
  const ids = await page.locator("[id]").evaluateAll(es => es.map(e => e.id));
  expect(ids.filter(id => id === "main")).toEqual(["main"]);
  expect(new Set(ids).size).toBe(ids.length);
  await reaches(page, "Main", "main-1");
});
