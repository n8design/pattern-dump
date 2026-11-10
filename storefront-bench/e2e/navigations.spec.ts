// A declared navigation (storefront.site.navigations.footer in the bench's config), as the footer partial
// renders it, read off the rendered DOM in pd dev and the built root: a page, an external link and a group,
// the current page's link marked aria-current="page", and the group above it marked.
import { expect, test, type Page } from "@playwright/test";

const nav = (page: Page) => page.locator("nav.site-footer-nav");
const links = (page: Page) => nav(page).locator("a").evaluateAll(as => as.map(a => [a.getAttribute("href"), a.textContent?.trim()]));

test("the footer navigation renders its pages, its external link and its group", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page)).toHaveAttribute("aria-label", "Footer");
  expect(await links(page)).toEqual([
    ["/about/", "About"], ["https://example.test/source", "Source"], ["/guides/setup/", "Setup"], ["/guides/", "All guides"],
  ]);
  await expect(nav(page).locator(".site-footer-group")).toHaveText("Guides");
  await expect(nav(page).locator("[aria-current]")).toHaveCount(0);
});

test("on a page in a group, its link is the current one and its group is marked", async ({ page }) => {
  await page.goto("/guides/setup/");
  const current = nav(page).locator('a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("Setup");
  const group = nav(page).locator("li.is-ancestor");
  await expect(group).toHaveCount(1);
  await expect(group.locator(".site-footer-group")).toHaveText("Guides");
});

test("on a page outside any group, its link is the current one and no group is marked", async ({ page }) => {
  await page.goto("/about/");
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveText("About");
  await expect(nav(page).locator("li.is-ancestor")).toHaveCount(0);
});
