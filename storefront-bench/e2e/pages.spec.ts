// Every storefront page, rendered in a browser — from pd dev, and from the built root on a static host.
import { expect, test } from "@playwright/test";

const PAGES: Array<[route: string, title: string, heading: string, current: string]> = [
  ["/", "Storefront bench", "Storefront bench", "Storefront bench"],
  ["/about/", "About — Storefront bench", "About", "About"],
  ["/guides/", "Guides — Storefront bench", "Guides", "Guides"],
  ["/guides/setup/", "Setup — Storefront bench", "Setup", "Setup"],
];

test.describe("storefront pages", () => {
  for (const [route, title, heading, current] of PAGES) {
    test(`${route} renders through its layout, with the nav marking it current`, async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveTitle(title);
      await expect(page.locator("h1")).toHaveText(heading);
      await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveText([current]);
      await expect(page.locator(".site-footer")).toHaveText("Built with Pattern Dump from the storefront bench.");
    });
  }

  test("the nav lists the pages in order, one level deep", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".site-nav-list > li > a")).toHaveText(["Storefront bench", "Guides", "About"]);
    await expect(page.locator(".site-nav-sub a")).toHaveText(["Setup"]);
  });

  test("loads no workbench shell stylesheet", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.locator('link[rel="stylesheet"]').evaluateAll(ls => ls.map(l => l.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).not.toContain("/_pd/main.css");
    expect(hrefs.some(h => h?.startsWith("/_pd/themes/"))).toBe(false);
  });
});

test.describe("live examples", () => {
  for (const [route, id] of [["/", "components/callout"], ["/guides/setup/", "components/callout~warning"]] as const) {
    test(`${route}: the ${id} frame fits its preview's height and fills the column's width`, async ({ page }) => {
      await page.goto(route);
      const frame = page.locator(`figure.doc-example iframe[src="/preview/${id}"]`);
      await expect(frame).toHaveCount(1);
      // Height: the frame follows the height its preview document posts (shorter than the UA's 150px).
      await expect.poll(async () => frame.evaluate((f: HTMLIFrameElement) => {
        const doc = f.contentDocument?.documentElement;
        const box = f.getBoundingClientRect().height - (f.offsetHeight - f.clientHeight);
        return doc ? Math.abs(box - doc.scrollHeight) <= 1 && box < 150 : false;
      })).toBe(true);
      // Width: the frame is exactly as wide as its container's content box.
      const widths = await frame.evaluate((f: HTMLIFrameElement) => {
        const fig = f.closest("figure")!;
        const cs = getComputedStyle(fig);
        return { frame: f.getBoundingClientRect().width, container: fig.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
      });
      expect(Math.abs(widths.frame - widths.container)).toBeLessThan(0.5);
      // The component inside is painted with its own CSS.
      await expect.poll(() => frame.evaluate((f: HTMLIFrameElement) => {
        const el = f.contentDocument?.querySelector(".callout");
        return el ? getComputedStyle(el).borderInlineStartWidth : null;
      })).toBe("4px");
    });
  }
});
