import { test, expect } from "@playwright/test";

// Full-page layout must be viewport-inert in height: the iframe fills the stage and a taller page
// scrolls inside it — it must NOT grow the viewport. Content-fitting height for viewport-relative
// content (pages/vh-fill uses height:100vh) is circular and balloons the iframe unbounded, streaming
// pd-height every frame. This bug is STRUCTURAL (feedback geometry), not environmental — it
// reproduces at DPR 1, deterministically. That is the regression test the fractional-height fixture
// could never be.
test.describe("full-layout viewport is height-inert (no ResizeObserver growth loop)", () => {
  test("a 100vh page settles — pd-height stops and the iframe never exceeds the stage", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __pdh: number }).__pdh = 0;
      window.addEventListener("message", (e: MessageEvent) => {
        if ((e.data as { type?: string } | null)?.type === "pd-height") {
          (window as unknown as { __pdh: number }).__pdh++;
        }
      }, true);
    });

    await page.goto("/pages/vh-fill");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.waitForTimeout(1500); // settle window
    const before = await page.evaluate(() => (window as unknown as { __pdh: number }).__pdh);
    await page.waitForTimeout(1500); // observe 1.5s of steady state
    const after = await page.evaluate(() => (window as unknown as { __pdh: number }).__pdh);

    // Without the fix the loop streams ~18 pd-height/s (~27 over 1.5s). With it: 0 (full layout
    // ignores pd-height). A couple of stragglers are fine; a stream is the bug.
    expect(after - before, "pd-height must settle in full layout (a stream = the growth loop)").toBeLessThan(3);

    // And the iframe must fill the stage, not balloon past it.
    const { iframeH, stageH } = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement;
      const sv = document.querySelector(".stage-view") as HTMLElement;
      return { iframeH: f.getBoundingClientRect().height, stageH: sv.getBoundingClientRect().height };
    });
    expect(iframeH, "iframe must not exceed the stage").toBeLessThanOrEqual(stageH + 2);
  });
});
