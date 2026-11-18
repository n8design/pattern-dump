// A component's symbol set on a site page (`requireAssets` of components/icon-label, placed on the about page), read
// off the paint: the page inlines the set once, hidden by its size, and the icon paints, its gradient included, in
// the bench's token, compared with a probe painted with the same token. A set hidden with display:none would leave
// the gradient unpainted in Chromium. In pd dev and on the built site.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

const ICON = "svg.icon-label-icon";

/** The painted colour at a point of the page, from a one-pixel screenshot, decoded by the page itself. */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 }, scale: "css" });
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, png.toString("base64"));
}

const near = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= 3);

test("a placed component's icon set is on the page once, hidden by size, and its icon paints", async ({ page }) => {
  await page.goto("/about/");
  await expect(page.locator(`symbol#bench-check`)).toHaveCount(1);
  const set = await page.locator("svg:has(> symbol#bench-check)").evaluate(e => ({
    ...e.getBoundingClientRect().toJSON() as { width: number; height: number }, display: getComputedStyle(e).display,
    parentIsBody: e.parentElement === document.body,
  }));
  expect([set.width, set.height, set.parentIsBody]).toEqual([0, 0, true]);
  expect(set.display).not.toBe("none");

  const icon = page.locator(ICON);
  await icon.scrollIntoViewIfNeeded();
  const box = (await icon.boundingBox())!;
  const fill = await page.evaluate(() => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;left:0;top:0;width:8px;height:8px;background:var(--color-fill);z-index:2147483647";
    d.id = "pd-test-probe";
    document.body.append(d);
    return null;
  }).then(() => pixel(page, 4, 4));
  await page.evaluate(() => document.getElementById("pd-test-probe")?.remove());
  expect(near(await pixel(page, box.x + box.width / 2, box.y + box.height / 2), fill), "the icon's gradient fill").toBe(true);
});
