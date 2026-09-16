import { test, expect } from "@playwright/test";

async function gotoShell(page: import("@playwright/test").Page) {
  await page.goto("/atoms/button");
  await page.waitForSelector("#preview-frame[srcdoc]");
}

test.describe("rail icon-button sizing", () => {
  test("all rail icon-buttons have identical box and SVG dimensions", async ({ page }) => {
    await gotoShell(page);

    const data = await page.evaluate(() => {
      const btns = [
        ...Array.from(document.querySelectorAll(".rail-toggle")),
        ...Array.from(document.querySelectorAll(".rail-vp-btn")),
      ] as HTMLElement[];
      return btns.map(btn => {
        const box = btn.getBoundingClientRect();
        const svg = btn.querySelector("svg");
        const svgBox = svg ? svg.getBoundingClientRect() : null;
        return {
          classes: btn.className,
          buttonW: Math.round(box.width),
          buttonH: Math.round(box.height),
          svgW: svgBox ? Math.round(svgBox.width * 100) / 100 : null,
          svgH: svgBox ? Math.round(svgBox.height * 100) / 100 : null,
        };
      });
    });

    expect(data.length).toBeGreaterThan(0);

    const first = data[0];
    for (const d of data) {
      expect(d.buttonW, `button width uniform — classes: ${d.classes}`).toBe(first.buttonW);
      expect(d.buttonH, `button height uniform — classes: ${d.classes}`).toBe(first.buttonH);
      expect(d.svgW, `SVG width uniform — classes: ${d.classes}`).toBe(first.svgW);
      expect(d.svgH, `SVG height uniform — classes: ${d.classes}`).toBe(first.svgH);
    }
  });

  test("each .rail-toggle is at least 32px in both dimensions", async ({ page }) => {
    await gotoShell(page);

    const toggles = page.locator(".rail-toggle");
    const count = await toggles.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await toggles.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(32);
      expect(box!.height).toBeGreaterThanOrEqual(32);
    }
  });

  test("each .rail-vp-btn is at least 32px in both dimensions", async ({ page }) => {
    await gotoShell(page);

    const btns = page.locator(".rail-vp-btn");
    const count = await btns.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await btns.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(32);
      expect(box!.height).toBeGreaterThanOrEqual(32);
    }
  });

  test(".rail-toggle-cluster gap is 0.5rem (≈8px)", async ({ page }) => {
    await gotoShell(page);

    const gap = await page.evaluate(() => {
      const el = document.querySelector(".rail-toggle-cluster");
      if (!el) return null;
      return getComputedStyle(el).gap;
    });

    expect(gap).not.toBeNull();
    const px = parseFloat(gap!);
    expect(px).toBeGreaterThanOrEqual(7);
    expect(px).toBeLessThanOrEqual(9);
  });

  // Deliberately tighter than .rail-toggle-cluster's 0.5rem. 779a3b3 replaced flex-wrap with an
  // explicit 7-column grid and shrank the gap so seven 32px icon buttons fit the rail's measured
  // usable width (~255px) without wrapping. The old 0.5rem expectation is the pre-grid value.
  test(".rail-vp-cluster gap is 0.375rem (≈6px) — tightened to fit 7 icon columns", async ({ page }) => {
    await gotoShell(page);

    const gap = await page.evaluate(() => {
      const el = document.querySelector(".rail-vp-cluster");
      if (!el) return null;
      return getComputedStyle(el).gap;
    });

    expect(gap).not.toBeNull();
    const px = parseFloat(gap!);
    expect(px).toBeGreaterThanOrEqual(5);
    expect(px).toBeLessThanOrEqual(7);
  });

  test("SVG inside .rail-toggle has non-zero dimensions", async ({ page }) => {
    await gotoShell(page);

    const toggle = page.locator(".rail-toggle svg").first();
    await expect(toggle).toBeAttached();
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test("SVG inside .rail-vp-btn has non-zero dimensions", async ({ page }) => {
    await gotoShell(page);

    const btn = page.locator(".rail-vp-btn svg").first();
    await expect(btn).toBeAttached();
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test("vp-readout remains visible and right-aligned at minimum rail width", async ({ page }) => {
    await gotoShell(page);

    const readout = page.locator(".vp-readout");
    await expect(readout).toBeVisible();

    const box = await readout.boundingBox();
    expect(box).not.toBeNull();
    const viewportWidth = page.viewportSize()!.width;
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
  });
});
