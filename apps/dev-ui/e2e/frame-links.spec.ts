// Links into the workbench from inside it (app/frame-links.ts). A link to a workbench pattern, in the Stage's preview
// or in a component's docs, selects that pattern with the workbench's own navigation, once, scrolled to the top, with
// no second workbench inside the frame; a link that leaves the workbench opens in the top window. If the frame
// navigates anyway, the shell selects the pattern it went to and puts the preview back. The preview document as served
// is unchanged: the shell attaches its listener from outside. Fixture: test-bench's atoms/linker.
import { test, expect, type Page } from "@playwright/test";
import { gotoComponentReady } from "./helpers";

/** The Stage shows `id`'s own document: its preview, not a page loaded into the frame. */
async function showsPreviewOf(page: Page, id: string): Promise<void> {
  await expect(page.locator(".preview-caption")).toHaveText(id);
  await page.waitForFunction((cid: string) => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    return f?.contentWindow?.location.href === "about:srcdoc" && !!f.contentDocument?.querySelector(`body[data-component-id='${cid}']`);
  }, id);
  // One workbench: the frame holds no shell of its own.
  await expect(page.locator("#preview-frame")).toHaveCount(1);
  expect(await page.frameLocator("#preview-frame").locator(".sidebar, #preview-frame").count()).toBe(0);
}

test("a preview's link to a pattern selects it, once, scrolled to the top", async ({ page }) => {
  await gotoComponentReady(page, "atoms/linker");
  await page.locator(".single-preview").evaluate(e => { e.scrollTop = e.scrollHeight; });
  const before = await page.evaluate(() => history.length);
  await page.frameLocator("#preview-frame").getByRole("link", { name: "To Button" }).click();
  await expect(page).toHaveURL(/\/atoms\/button$/);
  await showsPreviewOf(page, "atoms/button");
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
  expect(await page.locator(".single-preview").evaluate(e => e.scrollTop)).toBe(0);
  expect(await page.locator(".stage-view").evaluate(e => e.scrollTop)).toBe(0);
  await page.goBack();
  await showsPreviewOf(page, "atoms/linker");
});

test("a preview's link that leaves the workbench opens in the top window", async ({ page }) => {
  await gotoComponentReady(page, "atoms/linker");
  await page.frameLocator("#preview-frame").getByRole("link", { name: "Out of the workbench" }).click();
  await expect(page).toHaveURL(/\/robots\.txt$/);
});

test("a frame that navigates anyway: the shell selects the pattern and puts the preview back", async ({ page }) => {
  await gotoComponentReady(page, "atoms/linker");
  // A navigation the listener doesn't see: the frame's own script setting its address.
  await page.evaluate(() => { (document.getElementById("preview-frame") as HTMLIFrameElement).contentWindow!.location.href = "/atoms/input"; });
  await expect(page).toHaveURL(/\/atoms\/input$/);
  await showsPreviewOf(page, "atoms/input");
});

test("a docs link to a pattern selects it, by its route or by a published /workbench/ address", async ({ page }) => {
  await gotoComponentReady(page, "atoms/linker");
  await page.click("button[data-tab='docs']");
  await page.locator(".panel-content").getByRole("link", { name: "the field" }).click();
  await expect(page).toHaveURL(/\/molecules\/field$/);
  await showsPreviewOf(page, "molecules/field");

  await gotoComponentReady(page, "atoms/linker");
  await page.click("button[data-tab='docs']");
  await page.locator(".panel-content").getByRole("link", { name: "an input, as a published site writes it" }).click();
  await expect(page).toHaveURL(/\/atoms\/input$/);
  await showsPreviewOf(page, "atoms/input");
});

test("the preview document as served is unchanged: its one script is the measurement script", async ({ request }) => {
  const html = await (await request.get("/preview/atoms/linker")).text();
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
  expect(scripts).toHaveLength(1);
  expect(scripts[0]).toContain("pd-height");
  expect(html).not.toContain(`addEventListener("click"`);
});
