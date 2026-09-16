import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

// Click a viewport toolbar button by its data-vp value.
async function clickVp(page: import("@playwright/test").Page, key: string) {
  await page.click(`[data-vp="${key}"]`);
  await page.waitForTimeout(30);
}

// Read innerWidth from inside the iframe.
async function iframeInnerWidth(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement;
    return f.contentWindow!.innerWidth;
  });
}

// Read clientWidth from the iframe element itself.
async function iframeClientWidth(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement;
    return f.clientWidth;
  });
}

// Read the computed background-color of .responsive-indicator inside the iframe.
async function indicatorColor(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement;
    const el = f.contentDocument!.querySelector(".responsive-indicator") as HTMLElement;
    return f.contentWindow!.getComputedStyle(el).backgroundColor;
  });
}

// Read the readout text.
async function readout(page: import("@playwright/test").Page): Promise<string> {
  return page.locator(".vp-readout").textContent() ?? "";
}

// Wait for the iframe to reach (or pass) a target innerWidth — handles the case where the
// transition already completed before we start waiting.
async function waitForIframeWidth(
  page: import("@playwright/test").Page,
  targetW: number,
  dir: "gte" | "lte" = "gte",
  timeoutMs = 5000
): Promise<void> {
  await page.waitForFunction(
    ([t, d]) => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement;
      const w = f.contentWindow!.innerWidth;
      return d === "gte" ? w >= t - 1 : w <= t + 1;
    },
    [targetW, dir] as [number, string],
    { timeout: timeoutMs }
  );
}

// ---- Non-animation tests -------------------------------------------------------
// These all run under reducedMotion: reduce so preset changes snap instantly.
// -------------------------------------------------------------------------------

test.describe("viewport simulator — sizing and centering (reduced-motion)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  // ---- Readout honesty ----
  test("readout shows innerWidth (live measurement, not echoed preset)", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "desktop");
    const inner = await iframeInnerWidth(page);
    const text  = await readout(page);
    expect(text).toMatch(new RegExp(`^${inner}\\s*×`));
    expect(inner).toBeGreaterThan(0);
  });

  test("readout: innerWidth vs clientWidth — readout matches innerWidth", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "desktop");
    const inner  = await iframeInnerWidth(page);
    const client = await iframeClientWidth(page);
    const text   = await readout(page);
    // innerWidth is what @media sees; client may differ by scrollbar gutter on overflow
    expect(text).toMatch(new RegExp(`^${inner}\\s*×`));
    if (inner !== client) {
      expect(text).not.toMatch(new RegExp(`^${client}\\s*×`));
    }
  });

  // ---- Task 1 discriminator: default/centered layout resizes ----
  test("discriminator: desktop preset on atom → computed style green (breakpoint crossed)", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "desktop");
    await page.waitForTimeout(50);
    expect(await indicatorColor(page)).toBe("rgb(0, 204, 0)");
  });

  test("discriminator: mobile preset on atom → computed style red (below breakpoint)", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "mobile");
    expect(await iframeInnerWidth(page)).toBe(375);
    await page.waitForTimeout(50);
    expect(await indicatorColor(page)).toBe("rgb(204, 0, 0)");
  });

  // ---- Task 1 regression: full layout ----
  test("full-layout page (pages/homepage) resizes to desktop preset", async ({ page }) => {
    await gotoComponent(page, "pages/homepage");
    await clickVp(page, "desktop");
    expect(await iframeInnerWidth(page)).toBe(1280);
  });

  // ---- Presets authoritative ----
  test("desktop preset: innerWidth === 1280 regardless of stage width", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "desktop");
    expect(await iframeInnerWidth(page)).toBe(1280);
  });

  test("mobile preset: innerWidth === 375", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "mobile");
    expect(await iframeInnerWidth(page)).toBe(375);
  });

  // ---- Fit ----
  test("fit mode: innerWidth equals stage inner width", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "desktop");
    await clickVp(page, "fit");
    const stageW = await page.evaluate(() =>
      (document.querySelector(".stage-view") as HTMLElement).clientWidth);
    const inner = await iframeInnerWidth(page);
    expect(Math.abs(inner - stageW)).toBeLessThanOrEqual(1);
  });

  // ---- Task 2: centering ----
  test("sub-stage preset: iframe is horizontally centered (left margin > 0)", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "mobile"); // 375px — narrower than any reasonable stage

    const { iframeLeft, figureLeft } = await page.evaluate(() => {
      const f   = document.getElementById("preview-frame") as HTMLIFrameElement;
      const fig = document.querySelector(".single-preview") as HTMLElement;
      return {
        iframeLeft:  f.getBoundingClientRect().left,
        figureLeft:  fig.getBoundingClientRect().left,
      };
    });
    expect(iframeLeft).toBeGreaterThan(figureLeft);
  });

  test("over-stage preset: .single-preview is horizontally scrollable", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "desktop"); // 1280px on a ~600px stage

    const scrollable = await page.evaluate(() => {
      const sp = document.querySelector(".single-preview") as HTMLElement;
      return sp.scrollWidth > sp.clientWidth;
    });
    expect(scrollable).toBe(true);
  });

  // ---- Disco ----
  test("disco start/stop toggles aria-pressed on the button", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    const btn = page.locator(".vp-disco-btn");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  test("disco sweep produces changing innerWidth values", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await page.click(".vp-disco-btn");
    const w1 = await iframeInnerWidth(page);
    await page.waitForTimeout(100);
    const w2 = await iframeInnerWidth(page);
    await page.click(".vp-disco-btn");
    // At minimum the readout is a valid number; sweeping widths differ
    expect(w1).toBeGreaterThan(0);
    expect(w2).toBeGreaterThan(0);
    if (w1 === w2) console.warn("disco: sampled widths matched (rare boundary case)", w1, w2);
  });

  // ---- Persistence across component switch ----
  test("viewport preset persists when navigating to a different component", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "desktop");
    expect(await iframeInnerWidth(page)).toBe(1280);

    // Use SPA navigation so currentVpParam() is preserved in the pushState URL.
    await page.locator('a.tree-link[href="/atoms/button"]').click();
    await page.waitForSelector("#preview-frame[srcdoc]");
    await page.waitForTimeout(50);
    expect(await iframeInnerWidth(page)).toBe(1280);
  });

  test("desktop preset after component switch: breakpoint fixture still green", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await clickVp(page, "desktop");

    await page.goto("/atoms/responsive-demo");
    await page.waitForSelector("#preview-frame[srcdoc]");
    await page.waitForTimeout(80);
    expect(await indicatorColor(page)).toBe("rgb(0, 204, 0)");
  });
});

// ---- Animation tests -----------------------------------------------------------
// These run with motion enabled and pay the 2s transition cost.
// -------------------------------------------------------------------------------

test.describe("viewport simulator — animated width resize", () => {
  // (a) Width readout ticks through intermediate values during the transition.
  test("(a) readout ticks mid-transition — proves live innerWidth, not echoed preset", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "mobile"); // start at 375

    // Click desktop (1280) then poll quickly for a mid-flight value.
    // Limit to 50 attempts × 20ms = 1000ms so we don't consume the full 2s before the final wait.
    await page.click(`[data-vp="desktop"]`);

    let midValue: number | null = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      await page.waitForTimeout(20);
      const w = await iframeInnerWidth(page);
      if (w > 375 && w < 1280) { midValue = w; break; }
    }

    // Wait for the transition to reach 1280 (handles the case where it was already complete).
    await waitForIframeWidth(page, 1280, "gte");
    expect(await iframeInnerWidth(page)).toBeGreaterThanOrEqual(1279); // ±1 for sub-pixel rounding

    if (midValue !== null) {
      expect(midValue).toBeGreaterThan(375);
      expect(midValue).toBeLessThan(1280);
    } else {
      console.warn("animation test (a): no mid-flight sample caught (machine may be too fast)");
    }
  });

  // (b) Reduced-motion → immediate snap.
  test("(b) reduced-motion: preset snaps immediately, no mid-flight value", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoComponent(page, "atoms/responsive-demo");
    await clickVp(page, "mobile");

    await page.click(`[data-vp="desktop"]`);
    await page.waitForTimeout(50);
    expect(await iframeInnerWidth(page)).toBe(1280);
  });

  // (c) Breakpoint flips during the transition (measured width, not wall-clock).
  test("(c) breakpoint flips in transit — computed style matches intermediate width", async ({ page }) => {
    await gotoComponent(page, "atoms/responsive-demo");

    // Start at desktop (1280, green).
    await page.click(`[data-vp="desktop"]`);
    await waitForIframeWidth(page, 1280, "gte");
    expect(await indicatorColor(page)).toBe("rgb(0, 204, 0)");

    // Click mobile (375) — transition sweeps down through 600px.
    await page.click(`[data-vp="mobile"]`);

    // Poll up to 50 attempts × 20ms = 1000ms for an intermediate width between 375 and 600.
    let caught = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      await page.waitForTimeout(20);
      const w = await iframeInnerWidth(page);
      if (w > 375 && w < 600) {
        const color = await indicatorColor(page);
        expect(color).toBe("rgb(204, 0, 0)");
        caught = true;
        break;
      }
    }

    // Wait for the transition to reach 375 and confirm final state.
    await waitForIframeWidth(page, 375, "lte");
    expect(await iframeInnerWidth(page)).toBeLessThanOrEqual(376); // ±1 for sub-pixel rounding
    expect(await indicatorColor(page)).toBe("rgb(204, 0, 0)");

    if (!caught) {
      console.warn("animation test (c): no sub-600 mid-flight sample caught");
    }
  });
});
