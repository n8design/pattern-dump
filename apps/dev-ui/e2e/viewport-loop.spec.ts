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

// The same feedback geometry reaches a CENTERED preview, which DOES content-fit its height: any rule
// taller than the frame (a global `body { height: 200vh }`, as a PatternLab stylesheet in the base layer
// can carry) grows the document every time the frame grows, doubling to Blink's layout ceiling
// (33554428) in about a second. content-height.ts detects the run of growth and parks the frame at its
// last steady height. The rule is injected into the live preview rather than added as a fixture: it is
// the shell's loop under test, and the corpus stays as it is.
test.describe("centered layout with a viewport-relative height (no growth loop)", () => {
  test("a 200vh rule settles — pd-height stops and the frame stays sane", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __pdh: number }).__pdh = 0;
      window.addEventListener("message", (e: MessageEvent) => {
        if ((e.data as { type?: string } | null)?.type === "pd-height") {
          (window as unknown as { __pdh: number }).__pdh++;
        }
      }, true);
    });

    await page.goto("/atoms/button");
    await page.waitForFunction(() =>
      !!(document.getElementById("preview-frame") as HTMLIFrameElement | null)
        ?.contentDocument?.querySelector("body[data-component-id='atoms/button']"));
    await page.waitForTimeout(500); // the frame fits its content first

    await page.evaluate(() => {
      const doc = (document.getElementById("preview-frame") as HTMLIFrameElement).contentDocument!;
      const style = doc.createElement("style");
      style.textContent = "body { height: 200vh }";
      doc.head.appendChild(style);
    });

    await page.waitForTimeout(1500); // settle window
    const before = await page.evaluate(() => (window as unknown as { __pdh: number }).__pdh);
    await page.waitForTimeout(1500); // observe 1.5s of steady state
    const after = await page.evaluate(() => (window as unknown as { __pdh: number }).__pdh);
    expect(after - before, "pd-height must settle (a stream = the growth loop)").toBeLessThan(3);

    const { frameH, stageH, marked } = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement;
      const sv = document.querySelector(".stage-view") as HTMLElement;
      return {
        frameH: f.getBoundingClientRect().height,
        stageH: sv.getBoundingClientRect().height,
        marked: f.dataset.pdHeight === "circular",
      };
    });
    // Without the fix this is 33554428 (Blink's layout ceiling), and the readout reads it back.
    expect(frameH, "the frame must not balloon").toBeLessThanOrEqual(stageH * 4);
    expect(marked, "the preview is marked circular so the Console can say why").toBe(true);
  });
});
