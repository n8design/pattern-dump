import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

test.describe("preview-bleed: no shell-chrome injection", () => {
  test("srcdoc head has no /_pd/base.css link", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    const headHtml = await page
      .frameLocator("#preview-frame")
      .locator("head")
      .innerHTML();
    expect(headHtml).not.toContain("/_pd/base.css");
  });

  test("srcdoc head has no shell-injected style element", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    const styleCount = await page
      .frameLocator("#preview-frame")
      .locator("head style")
      .count();
    expect(styleCount).toBe(0);
  });

  test("srcdoc html element has no inline style attribute", async ({ page }) => {
    // Structural contract: the preview document carries zero shell-authored style.
    // Canvas backdrop is on the #preview-frame ELEMENT (shell scope), not injected into the doc.
    await gotoComponent(page, "atoms/button");
    const htmlStyle = await page
      .frameLocator("#preview-frame")
      .locator("html")
      .getAttribute("style");
    expect(htmlStyle, "html must carry no style= attribute").toBeNull();
  });

  test("html and body inside srcdoc compute transparent (backdrop is on the element)", async ({ page }) => {
    // Canvas is on #preview-frame (the shell element), not on html/body inside the doc.
    // Both html and body must stay at UA transparent — the same as an unstyled probe div.
    //
    // Probe is evaluated inside the preview iframe so getComputedStyle serialisation is
    // consistent across all three values (cross-frame access can serialize "rgba(0,0,0,0)"
    // vs "" depending on which window calls getComputedStyle — probing in-frame avoids that).
    await gotoComponent(page, "atoms/button");
    const frame = page.frameLocator("#preview-frame");

    // Transparent probe: a div with no background set, evaluated inside the same frame
    const uaTransparent = await frame.locator("body").evaluate(() => {
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      const val = getComputedStyle(probe).backgroundColor;
      document.body.removeChild(probe);
      return val;
    });

    const htmlBg = await frame.locator("html")
      .evaluate((el: Element) => getComputedStyle(el).backgroundColor);
    const bodyBg = await frame.locator("body")
      .evaluate((el: Element) => getComputedStyle(el).backgroundColor);
    expect(htmlBg, "html bg matches UA transparent probe").toBe(uaTransparent);
    expect(bodyBg, "body bg matches UA transparent probe").toBe(uaTransparent);
  });

  test("fixture component background shows over Canvas backdrop (precedence holds)", async ({ page }) => {
    // Real fixture: cvd-reference declares .cvd-card { background: #f4f4f5 } in its
    // component CSS. Expected value is sourced from the loaded stylesheet via CSSOM —
    // no hardcoded colour literals. Positive equality proves the component CSS loaded
    // and rendered correctly; negatives confirm no bleed from Canvas or --pd-surface.
    //
    // Theme coverage note: test-bench themes (light, teams-dark) set only CSS custom
    // properties — they declare no body/html backgrounds. The "theme > Canvas backdrop"
    // path is architecturally correct (themes apply inside the srcdoc; Canvas is on the
    // outer #preview-frame element in a different document) but has no corpus fixture.
    await gotoComponent(page, "atoms/cvd-reference");
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      const link = f?.contentDocument?.querySelector(
        "link[data-pd-comp='atoms/cvd-reference']"
      ) as HTMLLinkElement | null;
      return link?.sheet !== null;
    }, undefined, { timeout: 10_000 });

    // Read declared .cvd-card background-color from the loaded component stylesheet via CSSOM
    const declaredCardBg = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement;
      const doc = f.contentDocument!;
      for (const sheet of Array.from(doc.styleSheets)) {
        try {
          const link = sheet.ownerNode as HTMLLinkElement | null;
          if (link?.dataset?.pdComp !== "atoms/cvd-reference") continue;
          for (const rule of Array.from(sheet.cssRules)) {
            if ((rule as CSSStyleRule).selectorText === ".cvd-card") {
              return (rule as CSSStyleRule).style.backgroundColor;
            }
          }
        } catch { /* cross-origin or unloaded — skip */ }
      }
      return null;
    });
    expect(declaredCardBg, ".cvd-card rule must be found in the loaded component stylesheet").not.toBeNull();

    const resolvedCanvas = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "color-scheme:light;background:Canvas;position:absolute;opacity:0;pointer-events:none";
      document.body.appendChild(probe);
      const val = getComputedStyle(probe).backgroundColor;
      document.body.removeChild(probe);
      return val;
    });
    const resolvedSurface = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "background:var(--pd-surface);position:absolute;opacity:0;pointer-events:none";
      document.body.appendChild(probe);
      const val = getComputedStyle(probe).backgroundColor;
      document.body.removeChild(probe);
      return val;
    });

    const cardBg = await page
      .frameLocator("#preview-frame").locator(".cvd-card")
      .evaluate((el: Element) => getComputedStyle(el).backgroundColor);

    expect(cardBg, "cvd-card rendered bg matches its CSSOM-declared value").toBe(declaredCardBg);
    expect(cardBg, "cvd-card bg is not Canvas (fixture wins over backdrop)").not.toBe(resolvedCanvas);
    expect(cardBg, "cvd-card bg is not --pd-surface (no shell bleed)").not.toBe(resolvedSurface);
    expect(cardBg, "cvd-card bg is not transparent").not.toBe("rgba(0, 0, 0, 0)");
  });

  test("body margin equals UA baseline (no margin:0 override)", async ({ page }) => {
    // Build a UA-baseline control iframe that mirrors the shell's main-wrapper structure
    // so margin-collapse behaviour matches — an empty <body> would differ from
    // <body><main style="max-width:..."></main></body>.
    const uaMargin = await page.evaluate((): Promise<number> =>
      new Promise(resolve => {
        const f = document.createElement("iframe");
        f.srcdoc =
          "<!DOCTYPE html><html><head></head><body>" +
          '<main style="max-width:max-content;margin-inline:auto"></main>' +
          "</body></html>";
        document.body.appendChild(f);
        f.addEventListener("load", () => {
          const m = parseFloat(
            f.contentWindow!.getComputedStyle(f.contentDocument!.body).marginTop
          );
          document.body.removeChild(f);
          resolve(m);
        });
      })
    );

    for (const route of ["organisms/card", "atoms/button"]) {
      await gotoComponent(page, route);
      const previewMargin = await page
        .frameLocator("#preview-frame")
        .locator("body")
        .evaluate(() =>
          parseFloat(getComputedStyle(document.body).marginTop)
        );
      expect(previewMargin, `${route}: body margin matches UA`).toBe(uaMargin);
      expect(previewMargin, `${route}: body margin is non-zero`).not.toBe(0);
    }
  });

  test("organisms/card — df-reset and df-card still apply after strip", async ({ page }) => {
    await gotoComponent(page, "organisms/card");
    const frame = page.frameLocator("#preview-frame");
    const el = frame.locator(".df-card.df-reset").first();
    await expect(el).toBeAttached();

    const boxSizing = await el.evaluate(
      (n: Element) => getComputedStyle(n).boxSizing
    );
    expect(boxSizing, "df-reset: box-sizing is border-box").toBe("border-box");

    const borderRadius = await el.evaluate(
      (n: Element) => parseFloat(getComputedStyle(n).borderRadius)
    );
    expect(borderRadius, "df-card: border-radius is non-zero").toBeGreaterThan(0);
  });

  test("atoms/button — component CSS loads (cursor:pointer set by button.scss)", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    const frame = page.frameLocator("#preview-frame");
    const btn = frame.locator(".df-button").first();
    await expect(btn).toBeAttached();

    const cursor = await btn.evaluate(
      (n: Element) => getComputedStyle(n).cursor
    );
    // button.scss explicitly sets cursor:pointer; the UA default for <button> is "default".
    expect(cursor, "button.scss cursor:pointer loaded").toBe("pointer");
  });

  test("atoms/font-demo — PDTestFont @font-face resolves inside the preview", async ({ page }) => {
    await gotoComponent(page, "atoms/font-demo");
    const fontLoaded = await page
      .frameLocator("#preview-frame")
      .locator("body")
      .evaluate(async () => {
        const faces = await document.fonts.load("1em 'PDTestFont'");
        return faces.length > 0;
      });
    expect(fontLoaded, "PDTestFont resolves in font-demo preview").toBe(true);
  });

  test("layout main has inline style with max-width (not cascade-injected)", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    const mainStyle = await page
      .frameLocator("#preview-frame")
      .locator("main")
      .getAttribute("style");
    expect(mainStyle).toBeTruthy();
    expect(mainStyle).toContain("max-width");
  });
});

test.describe("preview-frame element — Canvas backdrop (shell scope)", () => {
  test("#preview-frame bg is Canvas (not --pd-surface), resolved via shell color-scheme:light", async ({ page }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    const resolvedCanvas = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "color-scheme:light;background:Canvas;position:absolute;opacity:0;pointer-events:none";
      document.body.appendChild(probe);
      const val = getComputedStyle(probe).backgroundColor;
      document.body.removeChild(probe);
      return val;
    });
    const resolvedSurface = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "background:var(--pd-surface);position:absolute;opacity:0;pointer-events:none";
      document.body.appendChild(probe);
      const val = getComputedStyle(probe).backgroundColor;
      document.body.removeChild(probe);
      return val;
    });

    const iframeBg = await page.evaluate(
      () => getComputedStyle(document.getElementById("preview-frame")!).backgroundColor
    );

    expect(iframeBg, "#preview-frame bg matches Canvas control").toBe(resolvedCanvas);
    expect(iframeBg, "#preview-frame bg is not --pd-surface").not.toBe(resolvedSurface);
  });
});

test.describe("cvd-reference CSS attribution", () => {
  test("atoms/cvd-reference preview links component CSS (not base)", async ({ page }) => {
    await gotoComponent(page, "atoms/cvd-reference");
    const headHtml = await page
      .frameLocator("#preview-frame")
      .locator("head")
      .innerHTML();
    expect(headHtml).toContain('data-pd-comp="atoms/cvd-reference"');
    expect(headHtml).not.toContain("/_pd/base.css");
  });

  test("cvd-reference CSS is scoped — absent from atoms/button preview", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    const headHtml = await page
      .frameLocator("#preview-frame")
      .locator("head")
      .innerHTML();
    expect(headHtml).not.toContain('data-pd-comp="atoms/cvd-reference"');
  });

  test("cvd-reference renders chip grid with CSS-driven layout", async ({ page }) => {
    await gotoComponent(page, "atoms/cvd-reference");
    const frame = page.frameLocator("#preview-frame");

    // Wait for the component CSS link to load its sheet
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      const doc = f?.contentDocument;
      const link = doc?.querySelector("link[data-pd-comp='atoms/cvd-reference']") as HTMLLinkElement | null;
      return link?.sheet !== null;
    }, undefined, { timeout: 10_000 });

    // .cvd-card must be display:grid (from cvd-reference.scss — no inline style sets this)
    const display = await frame.locator(".cvd-card").evaluate(
      (el: Element) => getComputedStyle(el).display
    );
    expect(display, "cvd-card is display:grid").toBe("grid");

    // All 24 patches must render (4 rows × 6 patches)
    const chipCount = await frame.locator(".cvd-chip").count();
    expect(chipCount, "24 colour chips rendered").toBe(24);

    // .cvd-chip border-radius comes from CSS (not inline) — proves stylesheet loaded
    const radius = await frame.locator(".cvd-chip").first().evaluate(
      (el: Element) => parseFloat(getComputedStyle(el).borderRadius)
    );
    expect(radius, "cvd-chip border-radius is non-zero (CSS loaded)").toBeGreaterThan(0);
  });
});
