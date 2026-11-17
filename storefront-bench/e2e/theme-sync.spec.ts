// A site page's light and dark belong to its skin; PD sets no theme on a page. A page's `data-theme`, when it names
// one of the preview themes, reaches the live examples it embeds (theme-sync.ts in the dev-server): on load, and
// whenever the skin changes it. Any other value, or none, leaves a preview at the theme it was built with ("light",
// the bench's default). Read off the rendered preview: its body's data-theme and its computed color-scheme.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

/** The theme the page's live example shows: its body's data-theme and the color-scheme that paints. */
const previewTheme = (page: Page): Promise<{ theme: string | null; scheme: string } | null> =>
  page.locator("figure.doc-example iframe").first().evaluate((f: HTMLIFrameElement) => {
    const body = f.contentDocument?.body;
    if (!body || !body.hasAttribute("data-component-id")) return null;
    return { theme: body.getAttribute("data-theme"), scheme: getComputedStyle(body).colorScheme };
  });

/** As a skin's toggle would: the page's theme on <html>. Null removes it. */
const setPageTheme = (page: Page, theme: string | null): Promise<void> => page.evaluate(t => {
  if (t === null) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}, theme);

test.describe("embedded previews follow the page's theme", () => {
  test("a preview keeps its built theme on a page that names none", async ({ page }) => {
    await page.goto("/");
    await expect.poll(() => previewTheme(page)).toEqual({ theme: "light", scheme: "light" });
  });

  test("the page's theme reaches an already loaded preview, and leaving it restores the built one", async ({ page }) => {
    await page.goto("/");
    await expect.poll(() => previewTheme(page)).toEqual({ theme: "light", scheme: "light" });
    await setPageTheme(page, "dark");
    await expect.poll(() => previewTheme(page)).toEqual({ theme: "dark", scheme: "dark" });
    // A value that names no preview theme leaves the preview at its built theme.
    await setPageTheme(page, "sepia");
    await expect.poll(() => previewTheme(page)).toEqual({ theme: "light", scheme: "light" });
    await setPageTheme(page, "dark");
    await expect.poll(() => previewTheme(page)).toEqual({ theme: "dark", scheme: "dark" });
    await setPageTheme(page, null);
    await expect.poll(() => previewTheme(page)).toEqual({ theme: "light", scheme: "light" });
  });

  test("a page that has its theme before its preview loads gives it to the preview", async ({ page }) => {
    // As a skin sets its theme early: before the page's scripts run and before the lazy frame loads.
    await page.addInitScript(() => {
      document.addEventListener("readystatechange", () => document.documentElement.setAttribute("data-theme", "dark"), { once: true });
    });
    await page.goto("/");
    await expect.poll(() => previewTheme(page)).toEqual({ theme: "dark", scheme: "dark" });
  });

  test("the page's theme on <body> counts when <html> has none", async ({ page }) => {
    await page.goto("/");
    await expect.poll(() => previewTheme(page)).toEqual({ theme: "light", scheme: "light" });
    await page.evaluate(() => document.body.setAttribute("data-theme", "dark"));
    await expect.poll(() => previewTheme(page)).toEqual({ theme: "dark", scheme: "dark" });
  });
});
