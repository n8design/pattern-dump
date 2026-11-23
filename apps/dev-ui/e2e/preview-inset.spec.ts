// The inset (config shell.inset, default 1rem): a component sits inside a margin of the preview frame's own ground,
// not against its edge; a full layout gets none. The margin is the frame's padding, so the document's viewport (what
// the readout reports, and what a preset sets) is unchanged. The frame takes the document's ground, so the margin is
// the component's own page. Read off the rendered elements.
import { test, expect, type Page } from "@playwright/test";
import { gotoComponentReady } from "./helpers";

const frameFacts = (page: Page) => page.evaluate(() => {
  const f = document.getElementById("preview-frame") as HTMLIFrameElement;
  const cs = getComputedStyle(f);
  const r = f.getBoundingClientRect();
  return {
    padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
    box: [Math.round(r.width), Math.round(r.height)],
    viewport: [f.contentWindow!.innerWidth, f.contentWindow!.innerHeight],
    background: cs.backgroundColor,
    bodyBackground: getComputedStyle(f.contentDocument!.body).backgroundColor,
  };
});

test("a component sits 1rem inside the frame, its viewport unchanged", async ({ page }) => {
  await gotoComponentReady(page, "atoms/button");
  await expect.poll(async () => (await frameFacts(page)).padding).toEqual(["16px", "16px", "16px", "16px"]);
  const f = await frameFacts(page);
  expect(f.box).toEqual([f.viewport[0] + 32, f.viewport[1] + 32]);
  await expect(page.locator(".vp-readout")).toHaveText(`${f.viewport[0]} × ${f.viewport[1]}`);
});

test("a full layout gets none: it is a whole page", async ({ page }) => {
  await gotoComponentReady(page, "layouts/article-shell");
  await expect(page.locator(".stage-view")).toHaveAttribute("data-layout", "full");
  expect((await frameFacts(page)).padding).toEqual(["0px", "0px", "0px", "0px"]);
});

test("the frame takes the document's ground, so the inset is the component's own page", async ({ page }) => {
  await gotoComponentReady(page, "atoms/grounded");
  await expect.poll(async () => (await frameFacts(page)).background).toBe("rgb(245, 240, 228)");
  // And back to the frame's own Canvas for a document with no ground.
  await gotoComponentReady(page, "atoms/button");
  await expect.poll(async () => (await frameFacts(page)).background).toBe("rgb(255, 255, 255)");
});
