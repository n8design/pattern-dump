// The workbench's breakpoints follow the browser's text size: the narrow layout's media query and the rail's
// container queries are in em, and the script that opens the Inspector on first load asks the same media query.
//
// The text size is the browser's own font-size setting, as a reader sets it: a fresh profile whose Preferences
// hold `webkit.webprefs.default_font_size`, opened in the full Chromium build (`channel: "chromium"`). Playwright's
// headless shell ignores that preference, and setting the size through the DevTools protocol gave a wrong layout
// in the Kiosk spike, so neither is used here.
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { save } from "../../../test-support/save.js";
import { gotoComponent } from "./helpers.js";

const profiles: string[] = [];

async function openWithTextSize(baseURL: string, fontSize: number, width: number): Promise<{ context: BrowserContext; page: Page }> {
  const dir = await mkdtemp(path.join(tmpdir(), "pd-text-size-"));
  profiles.push(dir);
  await mkdir(path.join(dir, "Default"), { recursive: true });
  await save(path.join(dir, "Default", "Preferences"),
    JSON.stringify({ webkit: { webprefs: { default_font_size: fontSize } } }));
  const context = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    baseURL,
    viewport: { width, height: 800 },
    reducedMotion: "reduce",
  });
  const page = context.pages()[0] ?? await context.newPage();
  return { context, page };
}

/** The Inspector's state once the component is in the Stage: init() applies its first-load choice before it routes. */
async function inspectorOpen(page: Page): Promise<boolean> {
  await gotoComponent(page, "atoms/button");
  return page.locator(".main").evaluate((el) => (el as HTMLElement).dataset["panelOpen"] !== undefined);
}

test.afterAll(async () => {
  await Promise.all(profiles.map((dir) => rm(dir, { recursive: true, force: true })));
});

test.describe("text size", () => {
  test("at 20px text, a 1000px window starts with the Inspector collapsed, and the script agrees", async ({}, testInfo) => {
    const { context, page } = await openWithTextSize(testInfo.project.use.baseURL!, 20, 1000);
    try {
      await page.goto("/");
      // The preference took: the root font size is the reader's setting.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20px");
      // 56.25em at 20px is 1125px, so 1000px is narrow for the CSS and for matchMedia alike.
      expect(await page.evaluate(() => matchMedia("(max-width: 56.25em)").matches)).toBe(true);
      expect(await inspectorOpen(page)).toBe(false);
      await expect(page.locator(".panel")).not.toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("at 16px text, the same 1000px window starts with the Inspector open", async ({}, testInfo) => {
    const { context, page } = await openWithTextSize(testInfo.project.use.baseURL!, 16, 1000);
    try {
      expect(await inspectorOpen(page)).toBe(true);
      await expect(page.locator(".panel")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("at 20px text, a window wider than 1125px starts with the Inspector open", async ({}, testInfo) => {
    const { context, page } = await openWithTextSize(testInfo.project.use.baseURL!, 20, 1200);
    try {
      expect(await inspectorOpen(page)).toBe(true);
      await expect(page.locator(".panel")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("at 20px text, the rail's accessibility label shortens at 187.5px and hides at 100px", async ({}, testInfo) => {
    const { context, page } = await openWithTextSize(testInfo.project.use.baseURL!, 20, 1280);
    try {
      await gotoComponent(page, "atoms/button");
      const picker = page.locator(".a11y-picker");
      expect(await picker.evaluate((el) => getComputedStyle(el).fontSize)).toBe("20px");
      const full = page.locator(".a11y-label-full");
      const short = page.locator(".a11y-label-short");
      // 9.375em and 5em of the picker's own 20px; the former 150px and 80px would still show the full label at 180px.
      await picker.evaluate((el) => { (el as HTMLElement).style.width = "188px"; });
      await expect(full).toBeVisible();
      await picker.evaluate((el) => { (el as HTMLElement).style.width = "180px"; });
      await expect(full).toBeHidden();
      await expect(short).toBeVisible();
      await picker.evaluate((el) => { (el as HTMLElement).style.width = "100px"; });
      await expect(short).toBeHidden();
    } finally {
      await context.close();
    }
  });
});
