// pd dev and pd build give the same page DOM, apart from what only pd dev has: the live-reload client, the
// workbench's address, and the base layer's `?v=N`, which pd dev adds once the base layer has changed so
// open pages fetch it again (a spec before this one may have changed it; pd build never writes it). Read
// once each frame has been fitted, so the fitter's heights are part of what is compared.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { BUILD_WORKBENCH_URL, DEV, domWithoutLiveClient, STATIC, WORKBENCH } from "./helpers.js";

async function settled(page: Page, url: string): Promise<string> {
  await page.goto(url);
  await expect.poll(() => page.locator("figure.doc-example iframe").evaluateAll(fs => fs.every(f => {
    const doc = (f as HTMLIFrameElement).contentDocument?.documentElement;
    return !!doc && (f as HTMLIFrameElement).style.height !== "1px" && (f as HTMLIFrameElement).style.height !== "";
  }))).toBe(true);
  return domWithoutLiveClient(page);
}

test.describe("pd dev and pd build", () => {
  for (const route of ["/", "/about/", "/guides/", "/guides/setup/"]) {
    test(`render the same DOM for ${route}`, async ({ page }) => {
      const dev = (await settled(page, DEV + route)).replaceAll(`${WORKBENCH}/`, BUILD_WORKBENCH_URL)
        .replace(/(href="\/_pd\/base\.css)\?v=\d+"/g, '$1"');
      const built = await settled(page, STATIC + route);
      expect(dev).toBe(built);
    });
  }
});
