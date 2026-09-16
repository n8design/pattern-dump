import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

test.describe("layout & regions", () => {
  test("all shell regions are present in the DOM", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    await expect(page.locator(".sidebar")).toBeAttached();
    await expect(page.locator(".stage")).toBeAttached();
    await expect(page.locator(".dock")).toBeAttached();
    await expect(page.locator(".panel")).toBeAttached();
  });

  test("sidebar is left of stage; dock is below stage", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");

    const sidebar = await page.locator(".sidebar").boundingBox();
    const stage = await page.locator(".stage").boundingBox();
    const dock = await page.locator(".dock").boundingBox();

    expect(sidebar).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(dock).not.toBeNull();

    // Sidebar is to the left of the stage.
    expect(sidebar!.x + sidebar!.width).toBeLessThanOrEqual(stage!.x + 5);

    // Dock is below the stage (its top ≥ stage top + stage height - small tolerance).
    expect(dock!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height - 5);
  });

  test("panel is right of the stage at wide viewport", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    const stage = await page.locator(".stage").boundingBox();
    const panel = await page.locator(".panel").boundingBox();

    expect(stage).not.toBeNull();
    expect(panel).not.toBeNull();

    // Panel right edge is to the right of the stage.
    expect(panel!.x).toBeGreaterThanOrEqual(stage!.x + stage!.width - 5);
  });

  test("figure fills the stage width", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    const stage = await page.locator(".stage").boundingBox();
    const figure = await page.locator("#single-preview").boundingBox();

    expect(stage).not.toBeNull();
    expect(figure).not.toBeNull();

    // The figure should fill the stage width (within 2px of rounding).
    expect(Math.abs(figure!.width - stage!.width)).toBeLessThan(3);
  });

  test("centered component: iframe is roughly horizontally centered in stage", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");

    const stageBox = await page.locator(".stage").boundingBox();
    const iframeBox = await page.locator("#preview-frame").boundingBox();

    expect(stageBox).not.toBeNull();
    expect(iframeBox).not.toBeNull();

    // For centered layout (atoms), the iframe width equals the stage width (100%).
    // place-self: safe center centers it vertically when content is short.
    // Horizontal: iframe fills full width, so x aligns with stage x.
    expect(Math.abs(iframeBox!.x - stageBox!.x)).toBeLessThan(5);
    expect(Math.abs(iframeBox!.width - stageBox!.width)).toBeLessThan(5);
  });

  test("full-mode page: stage-view has data-layout=full; iframe fills the figure", async ({
    page,
  }) => {
    await gotoComponent(page, "pages/homepage");

    // Layout attribute must be set to "full" for the pages category.
    await expect(page.locator(".stage-view[data-layout='full']")).toBeAttached();

    const figureBox = await page.locator("#single-preview").boundingBox();
    const iframeBox = await page.locator("#preview-frame").boundingBox();

    expect(figureBox).not.toBeNull();
    expect(iframeBox).not.toBeNull();

    // Iframe top-aligns with the figure (≤ 5px difference).
    expect(Math.abs(iframeBox!.y - figureBox!.y)).toBeLessThan(5);

    // Iframe fills the figure width.
    expect(Math.abs(iframeBox!.width - figureBox!.width)).toBeLessThan(5);

    // Iframe height fills the figure minus the caption row.
    const captionBox = await page.locator(".preview-caption").boundingBox();
    const captionHeight = captionBox?.height ?? 0;
    expect(Math.abs(iframeBox!.height - (figureBox!.height - captionHeight))).toBeLessThan(5);
  });

  test("full-mode iframe has no max-width constraint in preview document", async ({
    page,
  }) => {
    await gotoComponent(page, "pages/homepage");

    // Wait for the correct component document — avoids catching "about:blank" transitional state.
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      return !!f?.contentDocument?.querySelector("main[data-component-id='pages/homepage']");
    });

    // Evaluate max-width of the <main> inside the preview document.
    // Use page.evaluate with direct contentDocument access (same-origin srcdoc).
    const maxWidth = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      const main = f?.contentDocument?.querySelector("main");
      if (!main) return null;
      const win = main.ownerDocument?.defaultView ?? window;
      return win.getComputedStyle(main).maxWidth;
    });

    // layout-full must not apply a max-width (should be "none").
    expect(maxWidth).toBe("none");
  });

  test("caption sits above the dock", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    const captionBox = await page.locator(".preview-caption").boundingBox();
    const dockBox = await page.locator(".dock").boundingBox();

    expect(captionBox).not.toBeNull();
    expect(dockBox).not.toBeNull();

    // Caption bottom ≤ dock top (with 5px rounding tolerance).
    expect(captionBox!.y + captionBox!.height).toBeLessThanOrEqual(
      dockBox!.y + 5
    );
  });

  test("dock has four tabs; only one panel visible at a time", async ({ page }) => {
    // atoms/icon has no .json or .schema.json → JSON/Schema tabs are hidden → 4 visible tabs.
    // M4.11 added Diagnostics as a permanent dock tab, making it Source/HTML/Diagnostics/Console.
    await gotoComponent(page, "atoms/icon");

    const tablist = page.getByRole("tablist", { name: "Source and console" });
    await expect(tablist).toBeVisible();

    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toHaveText("Source");
    await expect(tabs.nth(1)).toHaveText("HTML");
    await expect(tabs.nth(2)).toHaveText("Diagnostics");
    await expect(tabs.nth(3)).toHaveText("Console");

    // Initially Source tab is selected; its panel is visible.
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#dock-panel-hbs")).toBeVisible();
    await expect(page.locator("#dock-panel-html")).not.toBeVisible();
    await expect(page.locator("#dock-panel-console")).not.toBeVisible();

    // Switch to HTML tab → only HTML panel visible.
    await tabs.nth(1).click();
    await expect(page.locator("#dock-panel-html")).toBeVisible();
    await expect(page.locator("#dock-panel-hbs")).not.toBeVisible();
    await expect(page.locator("#dock-panel-console")).not.toBeVisible();
  });

  test("Copy button label reflects active tab; hidden on Console tab", async ({
    page,
  }) => {
    // atoms/icon has no .json or .schema.json → 3 visible tabs (HBS, HTML, Console).
    await gotoComponent(page, "atoms/icon");

    const copyBtn = page.locator(".dock-copy-btn");
    const tabs = page
      .getByRole("tablist", { name: "Source and console" })
      .getByRole("tab");

    // Source/HBS tab active → copy visible with Handlebars label.
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toHaveText("Copy Handlebars");

    // HTML tab → copy visible with HTML label.
    await tabs.nth(1).click();
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toHaveText("Copy HTML");

    // Console tab → copy hidden (dock-facets bar hidden).
    await tabs.nth(2).click();
    await expect(copyBtn).not.toBeVisible();

    // Back to Source tab → copy visible with Handlebars label again.
    await tabs.nth(0).click();
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toHaveText("Copy Handlebars");
  });

  test("panel has docs, relationships and audit tabs", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    const panelTablist = page.getByRole("tablist", { name: "Panel tabs" });
    await expect(panelTablist).toBeVisible();

    const panelTabs = panelTablist.getByRole("tab");
    await expect(panelTabs).toHaveCount(3);
    await expect(panelTabs.nth(0)).toHaveText("Docs");
    await expect(panelTabs.nth(1)).toHaveText("Relationships");
    await expect(panelTabs.nth(2)).toHaveText("Audit");
  });

  test("panel collapses at the narrow breakpoint", async ({ page }) => {
    // Load at narrow viewport (< 900px) so init() does NOT set data-panel-open.
    await page.setViewportSize({ width: 800, height: 600 });
    await gotoComponent(page, "atoms/button");

    const panel = page.locator(".panel");
    await expect(panel).not.toBeVisible();

    // Panel toggle button makes it appear.
    await page.getByLabel("Docs panel", { exact: true }).click();
    await expect(panel).toBeVisible();
  });

  test("panel toggle at wide viewport collapses third grid track to 0", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoComponent(page, "atoms/button");

    const mainEl = page.locator(".main");

    // Panel starts open at wide viewport; third track > 0.
    await expect(mainEl).toHaveAttribute("data-panel-open", "");
    const openCols = await mainEl.evaluate((el) =>
      getComputedStyle(el as HTMLElement).gridTemplateColumns
    );
    const openThird = parseFloat(openCols.trim().split(/\s+/).at(-1) ?? "0");
    expect(openThird).toBeGreaterThan(100); // ≥ 15vw of 1280px ≈ 192px

    // Close the panel.
    await page.getByLabel("Docs panel", { exact: true }).click();
    await expect(mainEl).not.toHaveAttribute("data-panel-open");

    // Allow transition (150ms) to complete.
    await page.waitForTimeout(200);

    // Third grid track must resolve to 0.
    const closedCols = await mainEl.evaluate((el) =>
      getComputedStyle(el as HTMLElement).gridTemplateColumns
    );
    const closedThird = parseFloat(closedCols.trim().split(/\s+/).at(-1) ?? "999");
    expect(closedThird).toBeLessThan(2);

    // Stage right edge now reaches main right edge (no dead band).
    const mainBox  = await mainEl.boundingBox();
    const stageBox = await page.locator(".stage").boundingBox();
    expect(mainBox).not.toBeNull();
    expect(stageBox).not.toBeNull();
    expect(Math.abs((stageBox!.x + stageBox!.width) - (mainBox!.x + mainBox!.width))).toBeLessThan(5);
  });

  test("overview mode collapses panel track even when data-panel-open is set", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/atoms");
    await page.waitForSelector(".gallery");

    // Overview sets panel.hidden = true; the :has(.panel[hidden]) rule collapses the track to 0.
    // Wait for the CSS transition to finish before asserting (transition is 150ms).
    const mainEl = page.locator(".main");
    await page.waitForFunction(() => {
      const el = document.querySelector(".main");
      if (!el) return false;
      const cols = getComputedStyle(el).gridTemplateColumns;
      return parseFloat(cols.trim().split(/\s+/).at(-1) ?? "999") < 2;
    });

    const cols = await mainEl.evaluate((el) =>
      getComputedStyle(el as HTMLElement).gridTemplateColumns
    );
    const thirdTrack = parseFloat(cols.trim().split(/\s+/).at(-1) ?? "999");
    expect(thirdTrack).toBeLessThan(2);
  });

  // ---- Full-layout height-fit ----

  // Both tests below previously waited for an inline `--vp-h` on the iframe and asserted that
  // full-layout pages content-fit their height. That contract was deliberately reversed: full
  // layout is now HEIGHT-INERT. main.ts bails out of the height path for
  // `[data-layout="full"]` ("if (el.closest('[data-layout=\"full\"]')) return;") because feeding
  // a full page's content height back into the iframe balloons it unbounded — the
  // ResizeObserver growth loop that viewport-loop.spec.ts now guards. Only centered/fit layouts
  // content-fit height. `--vp-h` is therefore never written here, so the old waits could only
  // ever time out. These now assert the inert contract itself.

  test("full-layout page is height-inert: no --vp-h, iframe fills the stage", async ({ page }) => {
    await gotoComponent(page, "pages/homepage");
    await page.waitForTimeout(500);

    const { vpH, iframeH, stageH } = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement;
      const sv = document.querySelector(".stage-view") as HTMLElement;
      return {
        vpH: f.style.getPropertyValue("--vp-h"),
        iframeH: f.clientHeight,
        stageH: sv.clientHeight,
      };
    });

    // No height is pushed back from the content — that is the loop guard.
    expect(vpH).toBe("");
    // The iframe tracks the stage box rather than the content box.
    expect(stageH - iframeH).toBeLessThan(40);
  });

  test("full-layout page taller than stage: the preview document scrolls inside the iframe", async ({ page }) => {
    // Short viewport so the stage (~40px) is far smaller than the homepage content (~286px).
    await page.setViewportSize({ width: 1200, height: 200 });
    await gotoComponent(page, "pages/homepage");
    await page.waitForTimeout(500);

    const r = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement;
      const sp = document.querySelector(".single-preview") as HTMLElement;
      const d = f.contentDocument!;
      return {
        vpH: f.style.getPropertyValue("--vp-h"),
        iframeH: f.clientHeight,
        innerScrollH: d.documentElement.scrollHeight,
        innerClientH: d.documentElement.clientHeight,
        outerScrollH: sp.scrollHeight,
        outerClientH: sp.clientHeight,
      };
    });

    // Still inert, and the iframe did NOT grow to the content height.
    expect(r.vpH).toBe("");
    expect(r.iframeH).toBeLessThan(r.innerScrollH);
    // The overflow lives inside the preview document...
    expect(r.innerScrollH).toBeGreaterThan(r.innerClientH);
    // ...not in the shell's stage container, which must not scroll.
    expect(r.outerScrollH).toBe(r.outerClientH);
  });
});
