// Content-fit width for `centered` previews. The preview document adds no wrapper: it measures what
// its content needs and posts pd-width, and the Stage sizes the frame to that and centres it
// (stage/content-width.ts). `full` previews keep the full width; presets keep their own width.
// Everything here is read off the rendered frames, not the markup.

import { test, expect, type Page } from "@playwright/test";
import { gotoComponentReady } from "./helpers.js";

/** The main frame's box, the stage track's box, and the button's right edge inside the frame. */
async function frameGeometry(page: Page) {
  return page.evaluate(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement;
    const track = f.parentElement!.getBoundingClientRect();
    const r = f.getBoundingClientRect();
    const button = f.contentDocument?.querySelector(".df-button")?.getBoundingClientRect();
    return {
      frameWidth: r.width, left: r.left - track.left, right: track.right - r.right, trackWidth: track.width,
      innerWidth: f.contentWindow!.innerWidth, buttonRight: button?.right ?? null,
      overflow: f.contentDocument!.documentElement.scrollWidth > f.contentWindow!.innerWidth,
    };
  });
}

/** Wait until the main frame's width has stopped changing. */
async function settledWidth(page: Page): Promise<number> {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const w = await page.evaluate(() => document.getElementById("preview-frame")!.getBoundingClientRect().width);
    if (Math.abs(w - last) < 0.5) return w;
    last = w;
    await page.waitForTimeout(150);
  }
  throw new Error(`frame width never settled (last ${last})`);
}

test.describe("content-fit width — centered previews", () => {
  test("a centered atom's frame fits the content and is centred on the stage", async ({ page }) => {
    await gotoComponentReady(page, "atoms/button");
    await settledWidth(page);
    const g = await frameGeometry(page);

    expect(g.frameWidth, "frame narrower than the stage").toBeLessThan(g.trackWidth / 2);
    expect(Math.abs(g.left - g.right), "centred: equal space either side").toBeLessThan(2);
    expect(g.buttonRight, "the button renders").not.toBeNull();
    // The whole button fits: its right edge plus the UA body margin is the frame's width.
    expect(g.buttonRight!).toBeLessThanOrEqual(g.innerWidth);
    expect(Math.abs(g.innerWidth - (g.buttonRight! + 8)), "frame width = content + body margin").toBeLessThan(2);
    expect(g.overflow).toBe(false);
  });

  test("the fitted width is stable: no feedback loop", async ({ page }) => {
    await gotoComponentReady(page, "atoms/button");
    const first = await settledWidth(page);
    await page.waitForTimeout(1500);
    const later = await page.evaluate(() => document.getElementById("preview-frame")!.getBoundingClientRect().width);
    expect(Math.abs(later - first)).toBeLessThan(0.5);
  });

  test("a full-layout page keeps the full stage width", async ({ page }) => {
    await gotoComponentReady(page, "pages/homepage");
    await settledWidth(page);
    const g = await frameGeometry(page);
    expect(Math.abs(g.frameWidth - g.trackWidth)).toBeLessThan(2);
  });

  test("a responsive component keeps the full width: narrowing would flip its media queries", async ({ page }) => {
    // responsive-demo changes colour with @media width conditions. Fitting its frame would narrow the
    // viewport those conditions see, so the frame stays at the full stage width instead.
    await gotoComponentReady(page, "atoms/responsive-demo");
    await settledWidth(page);
    const g = await frameGeometry(page);
    expect(Math.abs(g.frameWidth - g.trackWidth)).toBeLessThan(2);
  });

  test("a preset keeps its own width", async ({ page }) => {
    await gotoComponentReady(page, "atoms/button", "?vp=mobile");
    await settledWidth(page);
    const g = await frameGeometry(page);
    expect(g.innerWidth).toBe(375);
  });

  test("returning to fit from a preset fits the content again", async ({ page }) => {
    await gotoComponentReady(page, "atoms/button", "?vp=mobile");
    await settledWidth(page);
    await page.click('[data-vp="fit"]');
    await settledWidth(page);
    const g = await frameGeometry(page);
    expect(Math.abs(g.innerWidth - (g.buttonRight! + 8))).toBeLessThan(2);
  });

  test("gallery tiles fit their content and are centred in the tile", async ({ page }) => {
    await gotoComponentReady(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");
    await expect(page.locator("#variants-gallery .gallery-item iframe")).toHaveCount(3);
    await expect.poll(async () => page.evaluate(() =>
      [...document.querySelectorAll<HTMLIFrameElement>("#variants-gallery .gallery-item iframe")].map(f => {
        const tile = f.parentElement!.getBoundingClientRect(), r = f.getBoundingClientRect();
        return r.width < tile.width / 2 && Math.abs((r.left - tile.left) - (tile.right - r.right)) < 2;
      }).every(Boolean)), { timeout: 10_000 }).toBe(true);
  });
});
