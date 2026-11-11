// A page's place in the site, as the doc layout shows it from page.section, page.breadcrumbs, page.prev and
// page.next, read off the rendered DOM in pd dev and the built root. The layout's sample data sets all four
// (its workbench preview), so a value missing on a real page would show the sample's instead.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { examplesFitted } from "./helpers.js";

const links = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll(as => as.map(a => [a.getAttribute("href"), a.textContent?.trim()]));

test("a page in a folder: its section, breadcrumbs through the folder, and its neighbours in the nav", async ({ page }) => {
  await page.goto("/guides/setup/");
  await expect(page.locator(".doc-section")).toHaveText("Guides");
  expect(await links(page, ".doc-breadcrumbs a")).toEqual([["/", "Storefront bench"], ["/guides/", "Guides"]]);
  await expect(page.locator(".doc-breadcrumbs [aria-current=page]")).toHaveText("Setup");
  expect(await links(page, ".doc-pager a")).toEqual([["/guides/", "Guides"], ["/about/", "About"]]);
  await expect(page.locator(".doc-prev")).toHaveAttribute("rel", "prev");
  await expect(page.locator(".doc-next")).toHaveAttribute("rel", "next");
});

test("the last page in the nav: its own section, Home as its breadcrumb, and no next page", async ({ page }) => {
  await page.goto("/about/");
  await expect(page.locator(".doc-section")).toHaveText("About");
  expect(await links(page, ".doc-breadcrumbs a")).toEqual([["/", "Storefront bench"]]);
  expect(await links(page, ".doc-pager a")).toEqual([["/guides/setup/", "Setup"]]);
  // The sample data's next page never stands in for the one this page does not have.
  await expect(page.locator(".doc-next")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Sample next page");
});

test("previous and next walk the nav across sections", async ({ page }) => {
  await page.goto("/guides/setup/");
  // The pager sits below this page's example: click once the example has its height, so the pager no longer moves.
  await examplesFitted(page);
  await page.locator(".doc-next").click();
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page.locator("h1")).toHaveText("About");
  await page.locator(".doc-prev").click();
  await expect(page).toHaveURL(/\/guides\/setup\/$/);
});
