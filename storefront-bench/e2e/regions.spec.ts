// Regions on the rendered page (regions.ts, toc.ts), against pd dev and the built root alike: the doc layout's sidebar
// region holds the table of contents, and its grid has a second column only when the page puts something there, read
// off the computed grid and the boxes. About asks for the derived TOC (toc: true), setup places <pd-toc> with links of
// its own, and plain has neither, so its sidebar is gone and the article takes the whole row.
import { expect, test } from "./fixtures.js";

const tracks = (value: string) => value.trim().split(/\s+/).length;

test.describe("the doc layout's sidebar region", () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1000, height: 720 }); });

  test("toc: true: the derived table of contents in the sidebar, beside the article", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.locator("body")).toHaveAttribute("data-pd-regions", "sidebar");
    const toc = page.locator(".doc-sidebar nav.doc-toc a");
    await expect(toc).toHaveText(["What it is for", "The skin"]);
    expect(await toc.evaluateAll(as => as.map(a => a.getAttribute("href")))).toEqual(["#what-it-is-for", "#the-skin"]);
    const frame = page.locator(".doc-frame");
    expect(tracks(await frame.evaluate(f => getComputedStyle(f).gridTemplateColumns))).toBe(2);
    const article = await page.locator("article.doc").boundingBox();
    const sidebar = await page.locator(".doc-sidebar").boundingBox();
    expect(sidebar!.x).toBeGreaterThanOrEqual(article!.x + article!.width);
    expect(Math.abs(sidebar!.y - article!.y)).toBeLessThan(1);
  });

  test("<pd-toc> with links of its own: those links, in the sidebar", async ({ page }) => {
    await page.goto("/guides/setup/");
    await expect(page.locator("body")).toHaveAttribute("data-pd-regions", "sidebar");
    await expect(page.locator(".doc-sidebar .doc-toc a")).toHaveText(["Pages", "Layouts", "Main", "About the bench"]);
    // Not in the body as well.
    await expect(page.locator(".doc-body .doc-toc")).toHaveCount(0);
  });

  test("neither: no sidebar, and the article takes the whole row", async ({ page }) => {
    await page.goto("/articles/plain/");
    await expect(page.locator("body")).toHaveAttribute("data-pd-regions", "");
    await expect(page.locator(".doc-sidebar")).toHaveCount(0);
    const frame = page.locator(".doc-frame");
    expect(tracks(await frame.evaluate(f => getComputedStyle(f).gridTemplateColumns))).toBe(1);
    const [f, a] = [await frame.boundingBox(), await page.locator("article.doc").boundingBox()];
    expect(Math.abs(a!.width - f!.width)).toBeLessThan(1);
  });

  test("at 390 px the sidebar goes under the article", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/about/");
    const article = await page.locator("article.doc").boundingBox();
    const sidebar = await page.locator(".doc-sidebar").boundingBox();
    expect(sidebar!.y).toBeGreaterThanOrEqual(article!.y + article!.height);
  });
});
