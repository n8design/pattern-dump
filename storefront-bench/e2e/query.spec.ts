// Queries on the rendered page, in pd dev and on the built root: the lists of pages that aren't a folder's own
// listing. The article layout lists related pages from the same folder by relevance through the compact view; the doc
// layout lists pages from every folder, and each doc page sets its own options; the home page writes its latest
// articles itself from the query's entries.
import { expect, test } from "./fixtures.js";

const related = (page: import("@playwright/test").Page) => page.locator(".related .compact-card a");

test("an article lists the related pages of its folder through the view (the layout's defaults)", async ({ page }) => {
  await page.goto("/articles/harbour/");
  await expect(page.locator(".related h2")).toHaveText("Related");
  await expect(related(page)).toHaveText(["Plain on purpose"]);
  await expect(related(page)).toHaveAttribute("href", "/articles/plain/");
  await expect(page.locator(".related .compact-card time")).toHaveText("October 2, 2026");
  await expect(page.locator(".related .compact-card time")).toHaveAttribute("datetime", "2026-10-02");
});

test("a page's own options: a hand-picked page first, then the pages in its category with any of its tags", async ({ page }) => {
  await page.goto("/about/");
  // Setup is picked; Plain is in design-systems with the tag design; the harbour has images but no category.
  await expect(related(page)).toHaveText(["Setup", "Plain on purpose"]);
});

test("a page's own options: one collection, by title Z to A, one page", async ({ page }) => {
  await page.goto("/guides/setup/");
  await expect(related(page)).toHaveText(["Plain on purpose"]);
});

test("a page that turns its query off shows no related pages, where its layout shows them on other pages", async ({ page }) => {
  // The same layout (doc) shows related pages on About.
  await page.goto("/about/");
  await expect(related(page)).not.toHaveCount(0);
  await page.goto("/articles/plain/");
  await expect(page.locator(".doc-title")).toHaveText("Plain on purpose");
  await expect(page.locator(".related")).toHaveCount(0);
});

test("the home page's latest articles: the query's entries, newest first, two", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-latest h2")).toHaveText("Latest articles");
  await expect(page.locator(".home-latest a")).toHaveText(["A harbour of cable cars", "Plain on purpose"]);
});
