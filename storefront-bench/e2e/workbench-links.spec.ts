// Every live example links into the workbench. In pd dev the link opens this process's workbench on the
// right component and variant; in the built site it points exactly at storefront.workbenchUrl. The link sits
// below its example, so a click waits until the example has its height: a click while it grows can land on
// the spot the link just left.
import { expect, test } from "./fixtures.js";
import { BUILD_WORKBENCH_URL, examplesFitted, isDev, WORKBENCH } from "./helpers.js";

test.describe("workbench links", () => {
  test("in pd dev, open the workbench on the example's component", async ({ page }, info) => {
    test.skip(!isDev(info), "pd dev only: the built site links to a workbench hosted elsewhere");
    await page.goto("/");
    await examplesFitted(page);
    await page.locator("figure.doc-example figcaption a").click();
    await expect(page).toHaveURL(`${WORKBENCH}/components/callout`);
    await page.waitForFunction(() => !!(document.getElementById("preview-frame") as HTMLIFrameElement | null)
      ?.contentDocument?.querySelector("body[data-component-id='components/callout']"));
    await expect(page.frameLocator("#preview-frame").locator(".callout-title")).toHaveText("Good to know");
  });

  test("in pd dev, open the workbench on the example's variant", async ({ page }, info) => {
    test.skip(!isDev(info), "pd dev only: the built site links to a workbench hosted elsewhere");
    await page.goto("/guides/setup/");
    await examplesFitted(page);
    await page.locator("figure.doc-example figcaption a").click();
    await expect(page).toHaveURL(`${WORKBENCH}/components/callout#warning`);
    await expect(page.frameLocator("#preview-frame").locator(".callout-title")).toHaveText("Careful");
  });

  test("in the built site, point exactly at storefront.workbenchUrl", async ({ page }, info) => {
    test.skip(isDev(info), "the built site only");
    await page.goto("/");
    await expect(page.locator("figure.doc-example figcaption a")).toHaveAttribute("href", `${BUILD_WORKBENCH_URL}components/callout`);
    await page.goto("/guides/setup/");
    await expect(page.locator("figure.doc-example figcaption a")).toHaveAttribute("href", `${BUILD_WORKBENCH_URL}components/callout#warning`);
    await expect(page.locator('a[href="https://workbench.example.test/components/callout"]')).toHaveText("callout");
  });
});
