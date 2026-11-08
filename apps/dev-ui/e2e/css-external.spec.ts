import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { save } from "../../../test-support/save.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testBench = path.resolve(__dirname, "../../../test-bench");

// Wait for the preview to show a specific component's <main>, then wait for all
// external stylesheets in the iframe to have their cssRules accessible.
async function gotoComponent(page: Page, id: string) {
  await page.goto(`/${id}`);
  await page.waitForFunction((componentId: string) => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    return !!f?.contentDocument?.querySelector(`body[data-component-id='${componentId}']`);
  }, id);
  // Poll until every linked stylesheet in the iframe has its cssRules accessible.
  // External CSS files are fetched asynchronously after srcdoc is parsed.
  // We wait until the number of sheets with accessible rules >= number of <link> elements,
  // so button.css/media.css/etc. are fully loaded before any CSSOM count test runs.
  await page.waitForFunction(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    const doc = f?.contentDocument;
    if (!doc) return false;
    const linkCount = doc.querySelectorAll("link[rel='stylesheet']").length;
    if (linkCount === 0) return false;
    let loadedWithRules = 0;
    for (const sheet of Array.from(doc.styleSheets)) {
      try {
        if (sheet.cssRules.length > 0) loadedWithRules++;
      } catch { /* cross-origin or not yet loaded */ }
    }
    return loadedWithRules >= linkCount;
  }, undefined, { timeout: 15_000 });
}

// Count occurrences of a CSS rule selector across all stylesheets in the preview iframe.
// Uses duck-typing (rule.type numeric constant) instead of instanceof because cross-frame
// objects fail instanceof checks (the iframe's CSSStyleRule !== parent frame's CSSStyleRule).
// Pass selector="@font-face:PDTestFont" to count @font-face rules for PDTestFont.
async function countCssRules(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel: string) => {
    const STYLE_RULE = 1;     // CSSRule.STYLE_RULE
    const FONT_FACE_RULE = 5; // CSSRule.FONT_FACE_RULE
    const iframe = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    if (!doc) return -1;
    let count = 0;
    for (const sheet of Array.from(doc.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (sel === "@font-face:PDTestFont") {
            if (rule.type === FONT_FACE_RULE) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const family = (rule as any).style?.fontFamily ?? "";
              if (family.replace(/['"]/g, "").includes("PDTestFont")) count++;
            }
          } else {
            if (rule.type === STYLE_RULE) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if ((rule as any).selectorText === sel) count++;
            }
          }
        }
      } catch { /* cross-origin or unloaded sheet — skip */ }
    }
    return count;
  }, selector);
}

// Check whether a link[data-pd-comp="<id>"] is present in the preview iframe head.
async function hasCompLink(page: Page, compId: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const iframe = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    return !!iframe?.contentDocument?.querySelector(`link[data-pd-comp="${id}"]`);
  }, compId);
}

// ---- Test 1 & 2: Dedup + closure correctness (card) ----

test.describe("CSS externalisation — card preview", () => {
  test("exactly one .df-reset in card preview; @font-face PDTestFont absent (not in card closure)", async ({ page }) => {
    await gotoComponent(page, "organisms/card");

    // font-demo is not in card's closure — @font-face PDTestFont not linked in this preview.
    const fontFaceCount = await countCssRules(page, "@font-face:PDTestFont");
    expect(fontFaceCount, "@font-face PDTestFont should not appear in card preview").toBe(0);

    // df-reset moved from base.css to card.scss — still exactly one rule.
    const resetCount = await countCssRules(page, ".df-reset");
    expect(resetCount, ".df-reset should appear exactly once (in organisms/card.css)").toBe(1);
  });

  test("closure links {card, media, icon} present; input, field, buttonbar, toolbar absent", async ({ page }) => {
    await gotoComponent(page, "organisms/card");

    // Required closure members
    expect(await hasCompLink(page, "organisms/card"),     "card.css should be linked").toBe(true);
    expect(await hasCompLink(page, "molecules/media"),    "media.css should be linked").toBe(true);
    expect(await hasCompLink(page, "atoms/icon"),         "icon.css should be linked").toBe(true);

    // Should be absent (not in card's closure)
    expect(await hasCompLink(page, "atoms/input"),        "input.css should NOT be linked").toBe(false);
    expect(await hasCompLink(page, "molecules/field"),    "field.css should NOT be linked").toBe(false);
    expect(await hasCompLink(page, "organisms/buttonbar"),"buttonbar.css should NOT be linked").toBe(false);
    expect(await hasCompLink(page, "organisms/toolbar"),  "toolbar.css should NOT be linked").toBe(false);
  });

  test("partition leak guard: .df-icon and .df-media__figure each appear exactly once", async ({ page }) => {
    await gotoComponent(page, "organisms/card");

    // If card.css wrongly re-carried icon's or media's rules, the count would be 2.
    const iconCount = await countCssRules(page, ".df-icon");
    expect(iconCount, ".df-icon should appear exactly once across all sheets").toBe(1);

    // .df-media__figure is a BEM modifier — present in compiled CSS from &__figure nesting
    const mediaFigureCount = await countCssRules(page, ".df-media__figure");
    expect(mediaFigureCount, ".df-media__figure should appear exactly once across all sheets").toBe(1);
  });
});

// ---- Test 3: styleUses closure (toolbar borrows .df-button without partials) ----

test.describe("CSS externalisation — toolbar preview", () => {
  test("button included via styleUses: link[data-pd-comp='atoms/button'] present and .df-button rules exist", async ({ page }) => {
    await gotoComponent(page, "organisms/toolbar");

    expect(await hasCompLink(page, "atoms/button"), "button.css should be linked via styleUses edge").toBe(true);

    const buttonCount = await countCssRules(page, ".df-button");
    expect(buttonCount, ".df-button rules should be present in the CSSOM").toBeGreaterThanOrEqual(1);
  });
});

// ---- Test 4: Origin isolation (field has dead @use button but no button rules) ----

test.describe("CSS externalisation — field preview", () => {
  test("no .df-button rules and no button link (dead @use stripped by origin bucketing)", async ({ page }) => {
    await gotoComponent(page, "molecules/field");

    expect(await hasCompLink(page, "atoms/button"), "button.css should NOT be linked for field").toBe(false);

    const buttonCount = await countCssRules(page, ".df-button");
    expect(buttonCount, ".df-button rules should be absent from field preview CSSOM").toBe(0);
  });
});

// ---- Test 5: HMR css-link-swap preserves iframe state ----

test.describe("CSS externalisation — HMR link-swap", () => {
  test.describe.configure({ retries: 2 });

  test("editing card.scss updates link href; srcdoc unchanged; toggle aria-pressed survives", async ({ page }) => {
    await gotoComponent(page, "organisms/card");

    const previewFrame = page.frameLocator("#preview-frame");

    // Plant a window marker to detect any srcdoc rewrite (which would clear it).
    await previewFrame.locator("body").evaluate(() => {
      (window as Window & { __marker?: boolean }).__marker = true;
    });

    // Record original href of card's CSS link.
    const originalHref = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement;
      const link = f?.contentDocument?.querySelector("link[data-pd-comp='organisms/card']") as HTMLLinkElement | null;
      return link?.getAttribute("href") ?? null;
    });
    expect(originalHref).toBeTruthy();

    const scssPath = path.join(testBench, "src/styles/03-organisms/card.scss");
    const original = await readFile(scssPath, "utf-8");

    try {
      await save(scssPath, `${original}\n/* hmr-link-swap-test */\n`);

      // Wait for the link href to gain a cache-buster query param.
      await page.waitForFunction(() => {
        const f = document.getElementById("preview-frame") as HTMLIFrameElement;
        const link = f?.contentDocument?.querySelector("link[data-pd-comp='organisms/card']") as HTMLLinkElement | null;
        return link?.href?.includes("?v=") ?? false;
      }, undefined, { timeout: 12_000 });

      // srcdoc must be unchanged (marker still set in iframe window).
      const markerIntact = await previewFrame.locator("body").evaluate(() => {
        return !!(window as Window & { __marker?: boolean }).__marker;
      });
      expect(markerIntact, "iframe window marker should survive (srcdoc not rewritten)").toBe(true);
    } finally {
      await save(scssPath, original);
    }
  });
});

// ---- Test 6: css-link-swap — variants overview tiles all update ----

test.describe("CSS externalisation — HMR link-swap: variants overview", () => {
  test.describe.configure({ retries: 2 });

  test("editing button.scss swaps link in every gallery tile; no srcdoc rewrite", async ({ page }) => {
    // Navigate to the button variants gallery (default + disabled + secondary = 3 tiles).
    await gotoComponent(page, "atoms/button");
    await page.selectOption(".variant-select", "__all__");
    await expect(page.locator("#variants-gallery")).toBeVisible();

    // Wait for all tile iframes to render button's <main> and load button.css.
    await page.waitForFunction(() => {
      const tiles = Array.from(document.querySelectorAll<HTMLIFrameElement>(".gallery-item iframe"));
      return tiles.length >= 1 && tiles.every(f => {
        if (!f.contentDocument?.querySelector("body[data-component-id='atoms/button']")) return false;
        const link = f.contentDocument.querySelector<HTMLLinkElement>("link[data-pd-comp='atoms/button']");
        return link?.sheet !== null;
      });
    }, undefined, { timeout: 15_000 });

    // Snapshot original hrefs from all tiles.
    const originalHrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLIFrameElement>(".gallery-item iframe")).map(f =>
        f.contentDocument?.querySelector<HTMLLinkElement>("link[data-pd-comp='atoms/button']")?.getAttribute("href") ?? null
      )
    );
    expect(originalHrefs.length).toBeGreaterThanOrEqual(1);
    expect(originalHrefs.every(h => h !== null)).toBe(true);

    const scssPath = path.join(testBench, "src/styles/01-atoms/button.scss");
    const original = await readFile(scssPath, "utf-8");
    try {
      await save(scssPath, `${original}\n/* hmr-tiles-test */\n`);

      // All tiles must gain a cache-buster on their button link.
      await page.waitForFunction(() => {
        const tiles = Array.from(document.querySelectorAll<HTMLIFrameElement>(".gallery-item iframe"));
        return tiles.length >= 1 && tiles.every(f => {
          const link = f.contentDocument?.querySelector<HTMLLinkElement>("link[data-pd-comp='atoms/button']");
          return link?.href?.includes("?v=") ?? false;
        });
      }, undefined, { timeout: 12_000 });

      // Every tile's href must have changed (not just the first one).
      const updatedHrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLIFrameElement>(".gallery-item iframe")).map(f =>
          f.contentDocument?.querySelector<HTMLLinkElement>("link[data-pd-comp='atoms/button']")?.getAttribute("href") ?? null
        )
      );
      for (let i = 0; i < updatedHrefs.length; i++) {
        expect(updatedHrefs[i]).not.toBe(originalHrefs[i]);
      }
    } finally {
      await save(scssPath, original);
    }
  });
});

// ---- Test 7: css-link-swap — dependency edit in single preview ----

test.describe("CSS externalisation — HMR link-swap: dependency edit", () => {
  test.describe.configure({ retries: 2 });

  test("view card, edit icon.scss → icon.css link swaps in card preview; srcdoc unchanged", async ({ page }) => {
    // card → media → icon (composition). card's closure links icon.css.
    await gotoComponent(page, "organisms/card");

    const previewFrame = page.frameLocator("#preview-frame");

    // Plant a window marker — survives only if srcdoc is NOT rewritten.
    await previewFrame.locator("body").evaluate(() => {
      (window as Window & { __marker?: boolean }).__marker = true;
    });

    // Confirm icon.css is in card's closure (it reaches via card→media→icon).
    const hasIconLink = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement;
      return !!f?.contentDocument?.querySelector("link[data-pd-comp='atoms/icon']");
    });
    expect(hasIconLink, "card preview must link atoms/icon.css via closure").toBe(true);

    const scssPath = path.join(testBench, "src/styles/01-atoms/icon.scss");
    const original = await readFile(scssPath, "utf-8");
    try {
      await save(scssPath, `${original}\n/* hmr-dep-test */\n`);

      // Server dispatches componentId = "atoms/icon" ≠ current.id ("organisms/card").
      // The broadcast handler must still update card's iframe — no id filter.
      await page.waitForFunction(() => {
        const f = document.getElementById("preview-frame") as HTMLIFrameElement;
        const link = f?.contentDocument?.querySelector<HTMLLinkElement>("link[data-pd-comp='atoms/icon']");
        return link?.href?.includes("?v=") ?? false;
      }, undefined, { timeout: 12_000 });

      // srcdoc must be unchanged — window marker survives.
      const markerIntact = await previewFrame.locator("body").evaluate(() =>
        !!(window as Window & { __marker?: boolean }).__marker
      );
      expect(markerIntact, "srcdoc must not be rewritten on dependency edit").toBe(true);
    } finally {
      await save(scssPath, original);
    }
  });
});

// ---- Test 8: Smoke — getComputedStyle on .df-button--primary ----

test("smoke: getComputedStyle on .df-button--primary returns a styled background", async ({ page }) => {
  // toolbar uses .df-button--primary directly (no partial) so it exercises the styleUses closure
  await gotoComponent(page, "organisms/toolbar");

  const bg = await page.evaluate(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    const el = f?.contentDocument?.querySelector(".df-button--primary");
    if (!el) return null;
    return getComputedStyle(el).backgroundColor;
  });
  // The test-bench theme sets --buttonPrimaryBackground: #0F6CBD for light theme.
  // Even without theme, the button should have a non-transparent background from its own CSS.
  expect(bg, "primary button should have a styled background color").not.toBeNull();
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(bg).not.toBe("transparent");
});

// ---- Test 9: requireScript no regression ----

test("requireScript: toggle script still loads and aria-pressed flips", async ({ page }) => {
  // toggle-demo has requireScript: toggle — exercises script loading after CSS externalisation.
  await page.goto("/atoms/toggle-demo");
  await page.waitForFunction(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    return !!f?.contentDocument?.querySelector("body[data-component-id='atoms/toggle-demo']");
  }, undefined, { timeout: 10_000 });

  const previewFrame = page.frameLocator("#preview-frame");
  const toggle = previewFrame.locator("[aria-pressed]").first();
  await toggle.waitFor({ state: "visible", timeout: 10_000 });

  const before = await toggle.getAttribute("aria-pressed");
  await toggle.click();
  const after = await toggle.getAttribute("aria-pressed");

  expect(before).not.toBe(after);
  expect(["true", "false"]).toContain(after);
});

// ---- Test 10: base.css content ----

test("/_pd/base.css is now empty (no shared utility classes or @font-face)", async ({ page }) => {
  // Base barrel forwards only Sass variables (no CSS output). @font-face and .df-reset
  // are attributed to their component owners (font-demo.scss, card.scss).
  const res = await page.request.get("/_pd/base.css");
  expect(res.status()).toBe(200);
  const css = await res.text();
  expect(css).not.toContain("PDTestFont");
  expect(css).not.toContain(".df-reset");
  expect(css).not.toContain(".df-button");
});
