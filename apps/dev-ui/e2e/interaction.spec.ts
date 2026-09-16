import { test, expect } from "@playwright/test";
import { gotoComponent, selectTheme } from "./helpers.js";

// Simulate a pointer drag on a resize handle.
// Drag a resize handle with REAL mouse input (page.mouse), not synthetic PointerEvents.
//
// This previously dispatched PointerEvents through page.evaluate, on the theory that
// page.mouse.* might land on an element covering the handle. That theory was wrong and the cost
// was high. The splitter's pointerdown handler calls `handle.setPointerCapture(pe.pointerId)`
// (main.ts:3095); a synthetic PointerEvent carries no active pointer id, so setPointerCapture
// throws NotFoundError and the handler aborts before it snapshots any dimension. Every drag was
// a silent no-op. Measured on the running app: synthetic dispatch left .sidebar at 320px
// (unchanged); real mouse input moved it 320px -> 400px for the same +80 delta.
//
// The no-op was invisible because the persistence assertions only matched /vw$/, which the
// untouched 25.00vw default satisfies — three tests passed while exercising nothing. Those
// assertions now require an actual change, so a regression here fails loudly.
// Pages whose resize handles have been proven interactive by a drag that actually moved.
const warmed = new WeakSet<import("@playwright/test").Page>();

async function drag(
  page: import("@playwright/test").Page,
  selector: string,
  deltaX: number,
  deltaY: number
) {
  const handle = page.locator(selector);
  await handle.waitFor({ state: "visible" });
  await page.waitForSelector(".sidebar-tree a.tree-link");

  const box = await handle.boundingBox();
  if (!box) throw new Error(`No bounding box for ${selector}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // The handles are wired during mount, after `#preview-frame[srcdoc]` (what gotoComponent waits
  // for) already resolves, so a drag issued too early is swallowed and the region never moves.
  //
  // Gate on the OUTCOME, not on a proxy. An earlier version waited for `data-no-transition` on
  // .main after mouse.down, on the assumption it meant "the pointerdown handler ran" — but that
  // flag is also set and rAF-cleared during init (main.ts:3192, 3282), so the wait could be
  // satisfied spuriously and the drag still went nowhere. Measuring the tracked dimension cannot
  // be fooled that way.
  //
  // This masks nothing: the calling tests still assert the region actually moved, so if resizing
  // genuinely regressed every attempt would no-op and the helper throws.
  const measure = () =>
    page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      const r = el.getBoundingClientRect();
      return sel === ".dock" ? r.height : r.width;
    }, selector.includes("dock-h") ? ".dock" : selector.includes("panel-w") ? ".panel" : ".sidebar");

  // Only the FIRST drag on a page has to prove movement. That is the one racing mount; later
  // drags may legitimately no-op when a delta is clamped at a floor/ceiling or rounds away
  // (e.g. the -8 step in the device-pixel test), and failing those would be wrong.
  const gateOnMovement = !warmed.has(page);
  const before = await measure();
  const attempts = gateOnMovement ? 3 : 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Move in steps with a frame between them so the handler tracks each pointermove.
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(cx + (deltaX * i) / steps, cy + (deltaY * i) / steps);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    // The settled-px -> vw/vh conversion and persist run after pointerup.
    await page.waitForTimeout(250);

    if (!gateOnMovement) return;
    if (Math.abs((await measure()) - before) >= 1) {
      warmed.add(page);
      return;
    }
    if (attempt < attempts) await page.waitForTimeout(400);
  }
  throw new Error(
    `first drag on ${selector} did not move the region after ${attempts} attempts ` +
      `(handles never became interactive, or resizing is broken)`,
  );
}

// Helper to read dims from the store's localStorage key (pd-view-state JSON).
async function readStoredDims(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const json = localStorage.getItem("pd-view-state");
    if (!json) return null;
    const state = JSON.parse(json) as { dims?: Record<string, string> };
    return state.dims ?? null;
  });
}

test.describe("interaction & state", () => {
  test("dragging the sidebar splitter persists a vw value in localStorage", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");
    const widthBefore = await page.evaluate(
      () => (document.querySelector(".sidebar") as HTMLElement).getBoundingClientRect().width);

    // Drag sidebar right edge to the right (widen).
    await drag(page, '[data-resize="sidebar-w"]', 60, 0);

    const dims = await readStoredDims(page);
    expect(dims?.sidebarW).toMatch(/^\d+(\.\d+)?vw$/);

    // The drag must actually have moved the region — a vw-shaped string alone is satisfied by
    // the untouched default, so it proves nothing on its own.
    const widthAfter = await page.evaluate(
      () => (document.querySelector(".sidebar") as HTMLElement).getBoundingClientRect().width);
    expect(widthAfter).toBeGreaterThan(widthBefore + 40);
  });

  test("dragging the dock splitter persists a vh value in localStorage", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");
    const heightBefore = await page.evaluate(
      () => (document.querySelector(".dock") as HTMLElement).getBoundingClientRect().height);

    // Drag dock top edge upward (taller dock).
    await drag(page, '[data-resize="dock-h"]', 0, -40);

    const dims = await readStoredDims(page);
    expect(dims?.dockH).toMatch(/^\d+(\.\d+)?vh$/);

    const heightAfter = await page.evaluate(
      () => (document.querySelector(".dock") as HTMLElement).getBoundingClientRect().height);
    expect(heightAfter).toBeGreaterThan(heightBefore + 20);
  });

  test("dragging the panel splitter persists a vw value in localStorage", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");
    const widthBefore = await page.evaluate(
      () => (document.querySelector(".panel") as HTMLElement).getBoundingClientRect().width);

    // Drag panel left edge to the left (widen panel).
    await drag(page, '[data-resize="panel-w"]', -60, 0);

    const dims = await readStoredDims(page);
    expect(dims?.panelW).toMatch(/^\d+(\.\d+)?vw$/);

    const widthAfter = await page.evaluate(
      () => (document.querySelector(".panel") as HTMLElement).getBoundingClientRect().width);
    expect(widthAfter).toBeGreaterThan(widthBefore + 40);
  });

  // The dock track is round()'d to a whole DEVICE pixel (calc(1px / var(--dpr))), so the dock top —
  // and every hairline/tab-baseline/pill riding below it — stays crisp at any drag position. A
  // fractional committed vh must still resolve to an integer device-px track.
  test("resized dock track resolves to a whole device pixel at every position", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");

    for (const dY of [-40, -117, 63, -8]) {
      await drag(page, '[data-resize="dock-h"]', 0, dY);
      // grid-template-rows has a 150ms transition — wait for the dock height to settle on a
      // whole device pixel before asserting (round() re-resolves once layout lands).
      await page.waitForFunction(() => {
        const dock = document.querySelector(".dock") as HTMLElement;
        const dpr = window.devicePixelRatio;
        const hDev = dock.getBoundingClientRect().height * dpr;
        const topDev = dock.getBoundingClientRect().top * dpr;
        return Math.abs(Math.round(hDev) - hDev) < 0.05 && Math.abs(Math.round(topDev) - topDev) < 0.05;
      }, undefined, { timeout: 800 });

      const grid = await page.evaluate(() => {
        const dock = document.querySelector(".dock") as HTMLElement;
        const dpr = window.devicePixelRatio;
        const r = dock.getBoundingClientRect();
        return { heightDev: r.height * dpr, topDev: r.top * dpr, dpr };
      });
      // Both the track height and the dock top land on the device grid → hairlines/baselines crisp.
      expect(Math.abs(Math.round(grid.heightDev) - grid.heightDev)).toBeLessThan(0.05);
      expect(Math.abs(Math.round(grid.topDev) - grid.topDev)).toBeLessThan(0.05);
    }
  });

  test("stored vw/vh sizes are restored and applied after reload", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");

    // Measure sidebar pixel width before dragging.
    const sidebarBefore = await page.evaluate(() =>
      (document.querySelector(".sidebar") as HTMLElement).getBoundingClientRect().width);

    // Drag the sidebar splitter.
    await drag(page, '[data-resize="sidebar-w"]', 80, 0);
    const dims = await readStoredDims(page);
    expect(dims?.sidebarW).toMatch(/vw$/);
    const storedW = dims!.sidebarW;

    // Reload: localStorage persists across reloads.
    await page.reload();
    await page.waitForSelector(".sidebar-tree a.tree-link");

    // The .main element should have --pd-sidebar-w set to the stored value.
    const applied = await page.evaluate(() => {
      const main = document.querySelector(".main") as HTMLElement;
      return main.style.getPropertyValue("--pd-sidebar-w");
    });
    expect(applied).toBe(storedW);

    // Round-trip: sidebar should be the same pixel width as after the drag (within 3px rounding).
    // Verifies that window.innerWidth is the correct vw reference frame.
    // The grid has a 150ms CSS transition — wait for it to settle before measuring.
    const expectedPx = sidebarBefore + 80;
    await page.waitForFunction(
      (expected) => {
        const sidebar = document.querySelector(".sidebar") as HTMLElement;
        return Math.abs(sidebar.getBoundingClientRect().width - expected) < 3;
      },
      expectedPx,
      { timeout: 500 },
    );
    const sidebarAfter = await page.evaluate(() =>
      (document.querySelector(".sidebar") as HTMLElement).getBoundingClientRect().width);
    expect(Math.abs(sidebarAfter - expectedPx)).toBeLessThan(3);
  });

  test("variant bar appears for a component with variants, is absent for one without", async ({
    page,
  }) => {
    // atoms/button has two variants (disabled, secondary).
    await gotoComponent(page, "atoms/button");
    await expect(page.locator(".variant-bar")).toBeVisible();

    // atoms/icon has no variants.
    await gotoComponent(page, "atoms/icon");
    await expect(page.locator(".variant-bar")).not.toBeVisible();
  });

  test("theme select sets data-theme on the preview iframe body", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");

    // Wait for iframe to finish loading.
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      return f?.contentDocument?.readyState === "complete";
    });

    // Select the "light" theme (test-bench defines light + dark).
    await selectTheme(page, "light");

    // data-theme must be set on the iframe's body.
    const previewFrame = page.frameLocator("#preview-frame");
    await expect(previewFrame.locator("body")).toHaveAttribute(
      "data-theme",
      "light"
    );
  });

  test("Shiki-highlighted source appears in the HBS dock panel on first load", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");

    // The HBS panel should contain a <pre> with highlighted code on first load —
    // no tab click needed because navigate() calls switchDockTab("hbs").
    const hbsPanel = page.locator("#dock-panel-hbs");
    await expect(hbsPanel).toBeVisible();
    await expect(hbsPanel.locator("pre")).toBeVisible();

    // Shiki output wraps tokens in <span> elements.
    const spanCount = await hbsPanel.locator("pre span").count();
    expect(spanCount).toBeGreaterThan(0);
  });
});
