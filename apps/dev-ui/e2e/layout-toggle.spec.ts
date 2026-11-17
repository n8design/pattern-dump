import { test, expect, type Page } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

// Full-height preview: layouts default to full like pages and templates, a schema's x-pd-preview sets a
// pattern's stored mode, and the rail's "Full height" toggle flips it for the current view (?layout=).
// Every assertion reads the rendered frame's box against the stage, not only data-layout.

/** The preview frame's box, the stage's, and whether the height is content-fitted (--vp-h). */
async function frame(page: Page): Promise<{ w: number; h: number; stageW: number; stageH: number; vpH: string }> {
  return page.evaluate(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement;
    const s = document.querySelector(".single-preview") as HTMLElement;
    const fb = f.getBoundingClientRect();
    const sb = s.getBoundingClientRect();
    return { w: fb.width, h: fb.height, stageW: sb.width, stageH: sb.height, vpH: f.style.getPropertyValue("--vp-h") };
  });
}

/** Fills the stage: the frame is the stage's width and its height bar the caption row, with no fitted height. */
async function expectFilled(page: Page): Promise<void> {
  await expect.poll(async () => {
    const r = await frame(page);
    return r.vpH === "" && r.stageW - r.w < 2 && r.stageH - r.h < 40;
  }).toBe(true);
}

/** Content height: a fitted height, well short of the stage. */
async function expectContentHeight(page: Page): Promise<void> {
  await expect.poll(async () => {
    const r = await frame(page);
    return r.vpH !== "" && r.h < r.stageH - 200;
  }).toBe(true);
}

const toggle = (page: Page) => page.locator(".layout-toggle-btn");

test.describe("full-height preview", () => {
  test("a layout fills the stage by default, and the toggle shows it as on", async ({ page }) => {
    await gotoComponent(page, "layouts/article-shell");
    await expect(page.locator(".stage-view")).toHaveAttribute("data-layout", "full");
    await expectFilled(page);
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("x-pd-preview: \"full\" in a schema makes an atom fill the stage", async ({ page }) => {
    await gotoComponent(page, "atoms/preview-full");
    await expectFilled(page);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("the toggle turns a layout to content height and back, through ?layout=", async ({ page }) => {
    await gotoComponent(page, "layouts/article-shell");
    await expectFilled(page);

    await toggle(page).click();
    await expect(page).toHaveURL(/\/layouts\/article-shell\?layout=centered$/);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expectContentHeight(page);

    await toggle(page).click();
    await expect(page).toHaveURL(/\/layouts\/article-shell$/);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expectFilled(page);
  });

  test("the toggle turns a centered atom to full and back", async ({ page }) => {
    await gotoComponent(page, "atoms/badge");
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expectContentHeight(page);

    await toggle(page).click();
    await expect(page).toHaveURL(/\/atoms\/badge\?layout=full$/);
    await expectFilled(page);

    await toggle(page).click();
    await expect(page).toHaveURL(/\/atoms\/badge$/);
    await expectContentHeight(page);
  });

  test("?layout= survives a reload and is dropped on navigating to another pattern", async ({ page }) => {
    await gotoComponent(page, "atoms/badge", "?layout=full");
    await expectFilled(page);
    await page.reload();
    await expect(page).toHaveURL(/\?layout=full$/);
    await expectFilled(page);

    await page.locator("a.tree-link[href$='/atoms/button']").click();
    await expect(page).toHaveURL(/\/atoms\/button$/);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expectContentHeight(page);
  });

  test("an unknown ?layout=, or one equal to the stored mode, is stripped and changes nothing", async ({ page }) => {
    await gotoComponent(page, "layouts/article-shell", "?layout=bogus");
    await expect(page).toHaveURL(/\/layouts\/article-shell$/);
    await expectFilled(page);

    await gotoComponent(page, "layouts/article-shell", "?layout=full");
    await expect(page).toHaveURL(/\/layouts\/article-shell$/);
    await expectFilled(page);
  });

  test("the toggle is hidden on a folder overview", async ({ page }) => {
    await gotoComponent(page, "atoms/badge");
    await expect(toggle(page)).toBeVisible();
    await page.goto("/atoms");
    await expect(page.locator("#category-overview")).toBeVisible();
    await expect(toggle(page)).toBeHidden();
  });
});
