// The behaviour scripts a page's components bring run on the page, in pd dev and as built: the header's (every
// layout's) and the slider's (placed on the guides page with a pd- tag) each mark their element, read off the
// rendered page.
import { expect, test } from "./fixtures.js";

test("a placed component's script and its layout's run on the page", async ({ page }) => {
  await page.goto("/guides/");
  await expect(page.locator(".site-header")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".slider").first()).toHaveAttribute("data-ready", "true");
});

test("a page that places nothing runs its layout's script only", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", r => { if (r.url().includes("/_pd/scripts/")) requested.push(new URL(r.url()).pathname); });
  await page.goto("/about/");
  await expect(page.locator(".site-header")).toHaveAttribute("data-ready", "true");
  expect(requested).toEqual(["/_pd/scripts/header-ready.js"]);
});
