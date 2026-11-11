// The skin's layouts and partials are ordinary patterns: the bench's workbench, on pd.localhost, lists
// them in its Nav Rail and documents them in its Inspector.
import { expect, test } from "./fixtures.js";
import { WORKBENCH } from "./helpers.js";

const SKIN: Array<[id: string, docs: string]> = [
  ["layouts/page", "Every page without a layout: uses this one."],
  ["layouts/article", "lede string optional"],
  ["layouts/doc", "page.headings"],
  ["layouts/home", "For the site's own index.md"],
  ["partials/base", "Used as a block partial"],
  ["partials/header", "At the top of every page"],
  ["partials/nav", "Built from the pages folder"],
  ["partials/footer", "At the bottom of every page"],
];

test.describe("the skin in the workbench", () => {
  test("lists every layout and partial, the embedded component, and the placed slider and slide", async ({ page }) => {
    await page.goto(`${WORKBENCH}/layouts/page`);
    await page.waitForSelector("#preview-frame[srcdoc]");
    const hrefs = await page.locator(".sidebar-tree a.tree-link").evaluateAll(as => as.map(a => a.getAttribute("href")));
    expect(hrefs.sort()).toEqual(["/components/callout", "/components/slide", "/components/slider", "/layouts/article", "/layouts/doc", "/layouts/home", "/layouts/page", "/partials/base", "/partials/footer", "/partials/head", "/partials/header", "/partials/nav"]);
  });

  test("documents partials/head, whose preview shows nothing: its markup all belongs in a head", async ({ page }) => {
    await page.goto(`${WORKBENCH}/partials/head`);
    await page.waitForFunction(() => !!(document.getElementById("preview-frame") as HTMLIFrameElement | null)
      ?.contentDocument?.querySelector("body[data-component-id='partials/head']"));
    await expect(page.locator(".panel")).toContainText("What the skin adds to every page's");
    const body = page.frameLocator("#preview-frame").locator("body");
    expect((await body.innerText()).trim()).toBe("");
    await expect(body.locator(`link[rel="icon"]`)).toHaveCount(1);
  });

  for (const [id, docs] of SKIN) {
    test(`documents ${id} and previews it`, async ({ page }) => {
      await page.goto(`${WORKBENCH}/${id}`);
      await page.waitForFunction((cid: string) => !!(document.getElementById("preview-frame") as HTMLIFrameElement | null)
        ?.contentDocument?.querySelector(`body[data-component-id='${cid}']`), id);
      await expect(page.locator(".panel")).toContainText(docs);
      expect((await page.frameLocator("#preview-frame").locator("body").innerText()).trim()).not.toBe("");
    });
  }
});
