// pd dev warns when a live example is declared taller than its content: the one mistake the fitter can't
// correct, since a frame is never fitted shorter than it starts. Checked once the preview has loaded and its
// fonts are ready, against the content's own height (the preview's root box, which unlike scrollHeight is not
// floored at the frame's height). A root box exactly as tall as the frame can't be told apart from content
// that fills its frame (`html { height: 100% }`), so it stays silent. Each check ends in one console.debug
// line, which the tests wait for instead of a timer. The built site carries no check.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { isDev } from "./helpers.js";

const CANT_TELL = "can't tell (the content is as tall as its frame)";
const done = (page: Page, ...outcomes: string[]) => page.waitForEvent("console",
  m => m.type() === "debug" && outcomes.some(o => m.text() === `[pd] example height of components/callout: ${o}`));

/** Serves the home page with the callout's declared height replaced. */
const declare = (page: Page, height: number) => page.route(url => url.pathname === "/", async route => {
  const res = await route.fetch();
  const body = (await res.text()).replace(`height="112"`, `height="${height}"`);
  await route.fulfill({ response: res, body });
});

test.describe("pd dev's check of a live example's declared height", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(!isDev(info), "pd dev only: the built site carries no check");
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("warns when the example is declared taller than its content", async ({ page }) => {
    await declare(page, 200);
    const warned = page.waitForEvent("console", m => m.type() === "warning");
    const checked = done(page, "too tall");
    await page.goto("/");
    await checked;
    const text = "components/callout: its live example is declared 200px tall (x-pd-example-height), but its content is "
      + "112px. A frame is never fitted shorter than it starts, so it stays too tall: declare at most 112.";
    expect((await warned).text()).toBe(text);
    await expect(page.locator("[data-pd-live-notice] li")).toHaveText([text]);
  });

  test("says nothing when the content is taller than declared", async ({ page }) => {
    // At 390px the callout is 136px against its 112. Checked before the fitter grows the frame it "fits", after
    // it the root box equals the frame, which can't be told; silent either way.
    await page.setViewportSize({ width: 390, height: 800 });
    const checked = done(page, "fits", CANT_TELL);
    await page.goto("/");
    await checked;
    await expect(page.locator("[data-pd-live-notice]")).toHaveCount(0);
  });

  test("says nothing when the content fills its frame, so its own height can't be told", async ({ page }) => {
    await declare(page, 200);
    await page.route(url => url.pathname === "/preview/components/callout", async route => {
      const res = await route.fetch();
      const body = (await res.text()).replace("</head>", "<style>html { height: 100%; }</style></head>");
      await route.fulfill({ response: res, body });
    });
    const checked = done(page, CANT_TELL);
    await page.goto("/");
    await checked;
    await expect(page.locator("[data-pd-live-notice]")).toHaveCount(0);
  });
});

test("the built site carries no check", async ({ page }, info) => {
  test.skip(isDev(info), "the built site only");
  await page.goto("/");
  await expect(page.locator("figure.doc-example iframe")).toHaveAttribute("height", "112");
  await expect(page.locator("script[data-pd-live]")).toHaveCount(0);
});
