import { test, expect } from "@playwright/test";

// ---- Helpers ----

async function previewFrame(page: import("@playwright/test").Page, id: string, variant?: string) {
  const url = `/preview/${id}${variant ? `?variant=${variant}` : ""}`;
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  return res.text();
}

// ---- Pass 1: /assets/ serving ----

test.describe("/assets/ serving", () => {
  test("serves project assets with correct MIME type", async ({ page }) => {
    const res = await page.request.get("/assets/fonts/pd-test.woff2");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/font\/woff2/);
  });

  test("serves SVG assets with correct MIME type", async ({ page }) => {
    const res = await page.request.get("/assets/images/symbols.svg");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/image\/svg\+xml/);
  });

  test("returns 404 for missing assets", async ({ page }) => {
    const res = await page.request.get("/assets/does-not-exist.png");
    expect(res.status()).toBe(404);
  });
});

// ---- Pass 1: Three preview-document layers ----

test.describe("document-base layer", () => {
  test("/_pd/base.css endpoint returns 200 with CSS content-type", async ({ page }) => {
    const res = await page.request.get("/_pd/base.css");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/css/);
    // base barrel only forwards Sass variables (emit no CSS) — body may be empty.
  });

  test("/_pd/base.css does not contain @font-face or .df-reset (attributed to owners)", async ({ page }) => {
    const css = await (await page.request.get("/_pd/base.css")).text();
    expect(css).not.toContain("PDTestFont");
    expect(css).not.toContain(".df-reset");
  });

  test("preview document does not link /_pd/base.css (shell injects nothing)", async ({ page }) => {
    const html = await previewFrame(page, "atoms/button");
    expect(html).not.toContain("/_pd/base.css");
  });

  test("preview document links theme stylesheets", async ({ page }) => {
    const html = await previewFrame(page, "atoms/button");
    expect(html).toContain("/_pd/themes/");
    expect(html).toContain('rel="stylesheet"');
  });

  test("preview document links per-component CSS with data-pd-comp", async ({ page }) => {
    const html = await previewFrame(page, "atoms/button");
    expect(html).toContain('data-pd-comp="atoms/button"');
    expect(html).toContain('/_pd/components/atoms/button.css');
  });
});

// ---- Pass 1: Theme serving ----

test.describe("theme CSS serving", () => {
  test("serves light theme CSS at /_pd/themes/light.css", async ({ page }) => {
    const res = await page.request.get("/_pd/themes/light.css");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/css/);
    const css = await res.text();
    expect(css).toContain("data-theme");
  });

  test("serves teams-dark theme CSS", async ({ page }) => {
    const res = await page.request.get("/_pd/themes/teams-dark.css");
    expect(res.status()).toBe(200);
    const css = await res.text();
    expect(css).toContain("data-theme");
  });

  test("theme switch changes computed color via data-theme", async ({ page }) => {
    await page.goto("/atoms/button");
    // Wait for the component and for all linked stylesheets (including button.css with theme vars).
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      const doc = f?.contentDocument;
      if (!doc?.querySelector("body[data-component-id='atoms/button']")) return false;
      // Wait for component CSS link to be loaded (sheet non-null).
      const link = doc.querySelector("link[data-pd-comp='atoms/button']") as HTMLLinkElement | null;
      return link?.sheet !== null;
    }, undefined, { timeout: 15_000 });

    // Select .df-button--primary via the toolbar (which uses it directly in markup via styleUses).
    // atoms/button only renders its own classes, so navigate to toolbar which borrows df-button.
    // Actually, the button preview renders the atom directly — get the element from atoms/button preview.
    const lightColor = await page.evaluate(() => {
      const doc = document.getElementById("preview-frame")?.contentDocument;
      const el = doc?.querySelector(".df-button--primary");
      if (!el) return null;
      return (el.ownerDocument?.defaultView ?? window).getComputedStyle(el).backgroundColor;
    });

    // Switch to teams-dark theme by setting data-theme on the preview body.
    await page.evaluate(() => {
      const doc = document.getElementById("preview-frame")?.contentDocument;
      doc?.body.setAttribute("data-theme", "teams-dark");
    });

    const darkColor = await page.evaluate(() => {
      const doc = document.getElementById("preview-frame")?.contentDocument;
      const el = doc?.querySelector(".df-button--primary");
      if (!el) return null;
      return (el.ownerDocument?.defaultView ?? window).getComputedStyle(el).backgroundColor;
    });

    expect(lightColor).not.toBeNull();
    expect(darkColor).not.toBeNull();
    expect(lightColor).not.toBe(darkColor);
  });
});

// ---- Pass 1: Font barrel forwarding ----

test.describe("font-demo — @font-face attributed to atoms/font-demo component", () => {
  test("/_pd/components/atoms/font-demo.css contains PDTestFont @font-face", async ({ page }) => {
    // font-demo.scss is attributed to atoms/font-demo — @font-face emits into its component CSS.
    const css = await (await page.request.get("/_pd/components/atoms/font-demo.css")).text();
    expect(css).toContain("PDTestFont");
  });

  test("atoms/font-demo preview links font-demo component CSS, not base.css", async ({ page }) => {
    const html = await previewFrame(page, "atoms/font-demo");
    expect(html).toContain("/_pd/components/atoms/font-demo.css");
    expect(html).not.toContain("/_pd/base.css");
  });
});

// ---- Pass 1: requireAssets — SVG symbol sets ----

test.describe("requireAssets — SVG symbol sets", () => {
  test("icon preview inlines SVG symbol set", async ({ page }) => {
    const html = await previewFrame(page, "atoms/icon");
    // atoms/icon has requireAssets: [symbols] in icon.md — symbols SVG is inlined hidden.
    expect(html).toContain("display:none");
    expect(html).toContain("pd-star");
  });

  test("icon component detail includes requireAssets", async ({ page }) => {
    const res = await page.request.get("/api/component/atoms/icon");
    expect(res.status()).toBe(200);
    const detail = await res.json() as { requireAssets?: string[] };
    expect(detail.requireAssets).toContain("symbols");
  });
});

// ---- Pass 1: requireScript — behaviour scripts ----

test.describe("requireScript — behaviour scripts", () => {
  test("/_pd/scripts/toggle.js returns 200 with JS", async ({ page }) => {
    const res = await page.request.get("/_pd/scripts/toggle.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/javascript/);
  });

  test("card preview includes script tag", async ({ page }) => {
    // organisms/card has requireScript: toggle in card.md.
    const html = await previewFrame(page, "organisms/card");
    expect(html).toContain("/_pd/scripts/toggle.js");
  });

  test("toggle script executes and handler binds to [data-toggle]", async ({ page }) => {
    await page.goto("/organisms/card");

    // Confirm the script ran (data-script-loaded is set unconditionally at the end of toggle.ts).
    await page.waitForFunction(
      () => {
        const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
        return !!f?.contentDocument?.querySelector("body[data-script-loaded='toggle']");
      },
      undefined,
      { timeout: 10_000 }
    );

    // Click the toggle button inside the iframe — aria-pressed must flip to "true".
    // This proves the click-handler was actually bound to the [data-toggle] element.
    await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      (f?.contentDocument?.querySelector("[data-toggle]") as HTMLElement | null)?.click();
    });
    const pressed = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      return f?.contentDocument?.querySelector("[data-toggle]")?.getAttribute("aria-pressed");
    });
    expect(pressed).toBe("true");
  });

  test("card component detail includes requireScripts", async ({ page }) => {
    const res = await page.request.get("/api/component/organisms/card");
    expect(res.status()).toBe(200);
    const detail = await res.json() as { requireScripts?: string[] };
    expect(detail.requireScripts).toContain("toggle");
  });
});

// ---- Pass 1: Composition aggregation ----

test.describe("composition aggregation", () => {
  // organisms/card has requireScript: [toggle] and composes molecules/media → atoms/icon
  // (which has requireAssets: [symbols]). Aggregation must collect both without duplication.

  test("card preview contains toggle script tag exactly once", async ({ page }) => {
    const html = await previewFrame(page, "organisms/card");
    const matches = [...html.matchAll(/\/_pd\/scripts\/toggle\.js/g)];
    expect(matches).toHaveLength(1);
  });

  test("card preview inlines symbols SVG exactly once", async ({ page }) => {
    const html = await previewFrame(page, "organisms/card");
    const matches = [...html.matchAll(/pd-star/g)];
    // pd-star appears at least once (in the inlined SVG definition).
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // The hidden SVG block appears exactly once — not duplicated.
    const hiddenSvgMatches = [...html.matchAll(/display:none/g)];
    expect(hiddenSvgMatches).toHaveLength(1);
  });

  test("card component detail aggregates both requireScripts and requireAssets", async ({ page }) => {
    // card → requireScript: [toggle]; card → media → icon → requireAssets: [symbols]
    const res = await page.request.get("/api/component/organisms/card");
    expect(res.status()).toBe(200);
    const detail = await res.json() as {
      requireScripts?: string[];
      requireAssets?: string[];
    };
    expect(detail.requireScripts).toContain("toggle");
    expect(detail.requireAssets).toContain("symbols");
  });
});

// ---- Pass 1: Dev-UI shell still loads from /_pd/ ----

test.describe("dev-ui shell routes", () => {
  test("shell loads at /", async ({ page }) => {
    const res = await page.request.get("/");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("/_pd/main.js");
    expect(html).toContain("/_pd/main.css");
  });

  test("/_pd/main.js returns JavaScript", async ({ page }) => {
    const res = await page.request.get("/_pd/main.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/javascript/);
  });
});

// ---- Pass 1: HMR still green ----
// (The existing hmr.spec.ts + css-external.spec.ts cover HMR in detail;
// this is a sanity check that per-component CSS links are wired after the externalisation.)

test.describe("HMR sanity — css-link-swap compatibility", () => {
  test("preview iframe has link[data-pd-comp='atoms/button'] for css-link-swap", async ({ page }) => {
    await page.goto("/atoms/button");
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      const doc = f?.contentDocument;
      return !!doc?.querySelector("body[data-component-id='atoms/button']")
        && !!doc?.querySelector("link[data-pd-comp='atoms/button']");
    });
  });
});
