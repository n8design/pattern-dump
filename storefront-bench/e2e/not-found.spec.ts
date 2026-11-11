// The 404 page, served at an address far below the root as a host serves it for any missing path: with
// status 404, styled by the skin, and every URL in it (stylesheets, icon, links) working from there. The
// bench has no 404.md, so this is the built-in page through layouts/page.
import { expect, test } from "./fixtures.js";
import { isDev } from "./helpers.js";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { save } from "../../test-support/save.js";

const DEEP = "/a/b/c/";

test("a deep missing address gets the 404 page, styled, with every URL in it working there", async ({ page, request }) => {
  const res = await page.goto(DEEP);
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("Page not found");
  // The skin's stylesheet applied: .site is a grid only by its rule (a div is a block without it).
  expect(await page.locator(".site").evaluate(el => getComputedStyle(el).display)).toBe("grid");
  await expect(page).toHaveTitle(/^Page not found/);
  await expect(page.locator(`meta[name="robots"]`)).toHaveAttribute("content", "noindex");

  // Every URL the page references, resolved from this deep address as the browser resolves it, is served.
  const urls = await page.evaluate(() => [
    ...[...document.querySelectorAll<HTMLLinkElement>("link[href]")].map(l => l.href),
    ...[...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map(a => a.href),
    ...[...document.querySelectorAll<HTMLImageElement | HTMLScriptElement>("img[src], script[src]")].map(e => e.src),
  ].filter(u => u.startsWith(location.origin)));
  expect(urls.length).toBeGreaterThan(3);
  for (const url of new Set(urls)) {
    const r = await request.get(url);
    expect(r.status(), url).toBe(200);
  }

  // Its link home takes the reader home.
  await page.locator("main a", { hasText: "home page" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("h1")).toHaveText("Storefront bench");
});

test("/404.html itself is the same page: in pd dev with 404, on a static host as the file it is", async ({ page }, info) => {
  const res = await page.goto("/404.html");
  // pd dev answers its route with 404 (what pd build writes); a static host serves the file itself with 200.
  expect(res?.status()).toBe(isDev(info) ? 404 : 200);
  await expect(page.locator("h1")).toHaveText("Page not found");
});

test("pd dev: a 404 page open at a missing address shows a new, an edited and a removed 404.md, by itself", async ({ page }, info) => {
  test.skip(!isDev(info), "live reload is pd dev's");
  const file = fileURLToPath(new URL("../pages/404.md", import.meta.url));
  const main = page.locator("main");
  try {
    await page.goto(DEEP);
    await expect(main).toContainText("There is no page at this address.");
    await save(file, "---\ntitle: Lost\n---\n\nFirst words.\n");
    await expect(main).toContainText("First words.", { timeout: 10_000 });
    await save(file, "---\ntitle: Lost\n---\n\nSecond words.\n");
    await expect(main).toContainText("Second words.", { timeout: 10_000 });
    await rm(file);
    // The test's own cleanup, waited for: the open page is back to the built-in one.
    await expect(main).toContainText("There is no page at this address.", { timeout: 10_000 });
  } finally {
    await rm(file, { force: true });
  }
});
