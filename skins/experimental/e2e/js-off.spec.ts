// With scripting off a page is still readable, and every live example still leads into the workbench.
import { expect, test } from "@playwright/test";
import { BUILD_WORKBENCH_URL, isDev, WORKBENCH } from "./helpers.js";

test.use({ javaScriptEnabled: false });

test.describe("storefront pages with JavaScript off", () => {
  test("the home page reads, and its example is a frame with a working link beside it", async ({ page }, info) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("Storefront bench");
    await expect(page.locator(".page-body")).toContainText("Every markdown file in pages/ is a page");
    const frame = page.locator("figure.doc-example iframe");
    await expect(frame).toHaveAttribute("src", "/preview/components/callout");
    // The frame keeps the UA default height: it is not fitted without script, and still shows the component.
    expect(Math.round(await frame.evaluate((f: HTMLIFrameElement) => f.clientHeight))).toBe(150);
    const base = isDev(info) ? `${WORKBENCH}/` : BUILD_WORKBENCH_URL;
    await expect(page.locator("figure.doc-example figcaption a")).toHaveAttribute("href", `${base}components/callout`);
  });

  test("a live example lists its component's variants, each a link that opens that variant's preview", async ({ page }) => {
    await page.goto("/");
    const variants = page.locator("figure.doc-example .doc-example-variants a");
    expect(await variants.evaluateAll(as => as.map(a => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])))
      .toEqual([["default", "/preview/components/callout", "true"], ["warning", "/preview/components/callout~warning", null]]);
    await variants.filter({ hasText: "warning" }).click();
    await expect(page).toHaveURL(/\/preview\/components\/callout~warning(\/|\.html)?$/);
    await expect(page.locator("body")).toContainText("Careful");
  });

  test("a page's chapters open and close without script, the first one open", async ({ page }) => {
    await page.goto("/guides/setup/");
    const chapters = page.locator("details.chapter");
    await expect(chapters.locator("summary h2")).toHaveText(["(01) Pages", "(02) Layouts"]);
    expect(await chapters.evaluateAll(ds => ds.map(d => (d as HTMLDetailsElement).open))).toEqual([true, false]);
    await expect(page.getByText("A page picks its layout in its frontmatter")).toBeHidden();
    await chapters.nth(1).locator("summary").click();
    await expect(page.getByText("A page picks its layout in its frontmatter")).toBeVisible();
    await chapters.nth(0).locator("summary").click();
    await expect(page.getByText("Each markdown file in pages/ is a page")).toBeHidden();
  });

  test("an article reads, nav and all", async ({ page }) => {
    await page.goto("/guides/setup/");
    await expect(page.locator(".article-lede")).toHaveText("Three folders make a site — the pages, the layouts that dress them, and the components they show.");
    await expect(page.locator('.site-nav a[aria-current="true"]')).toHaveText(["(01) Guides"]);
  });
});
