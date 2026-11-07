// pd dev and pd build give the same page DOM, apart from the live-reload client and the workbench's
// address. Read once each frame has been fitted, so the fitter's heights are part of what is compared.
import { expect, test, type Page } from "@playwright/test";
import { BUILD_WORKBENCH_URL, DEV, domWithoutLiveClient, openChapters, STATIC, WORKBENCH } from "./helpers.js";

async function settled(page: Page, url: string): Promise<string> {
  await page.goto(url);
  // Every chapter open, the same way on both, so every live example loads and is fitted.
  await openChapters(page);
  await expect.poll(() => page.locator("figure.doc-example iframe").evaluateAll(fs => fs.every(f => {
    const doc = (f as HTMLIFrameElement).contentDocument?.documentElement;
    return !!doc && (f as HTMLIFrameElement).style.height !== "1px" && (f as HTMLIFrameElement).style.height !== "";
  }))).toBe(true);
  return domWithoutLiveClient(page);
}

test.describe("pd dev and pd build", () => {
  for (const route of ["/", "/about/", "/guides/", "/guides/setup/"]) {
    test(`render the same DOM for ${route}`, async ({ page }) => {
      const dev = (await settled(page, DEV + route)).replaceAll(`${WORKBENCH}/`, BUILD_WORKBENCH_URL);
      const built = await settled(page, STATIC + route);
      expect(dev).toBe(built);
    });
  }
});
