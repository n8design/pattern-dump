// The workbench from a `pd build` snapshot of test-bench, served as plain files under /pd/ by a file
// server (e2e/static-server.mjs) — how a static host serves it, with no Pattern Dump code behind it.
// baseURL is http://127.0.0.1:4200/pd/, so relative gotos land under the base path.

import { test, expect, type Page } from "@playwright/test";

/** Collect what the static site must never do: leave the base path, 404 unexpectedly, open a socket. */
function watch(page: Page) {
  const seen = { outside: [] as string[], notFound: [] as string[], sockets: [] as string[], errors: [] as string[] };
  page.on("request", r => {
    const u = new URL(r.url());
    if (u.hostname === "127.0.0.1" && !u.pathname.startsWith("/pd/")) seen.outside.push(u.pathname);
  });
  page.on("response", r => { if (r.status() === 404) seen.notFound.push(new URL(r.url()).pathname); });
  page.on("websocket", ws => seen.sockets.push(ws.url()));
  page.on("pageerror", e => seen.errors.push(String(e)));
  return seen;
}

// 404s that happen identically on the live server: test-bench fixtures referencing files that do
// not exist, and the one template that deliberately fails to render.
const KNOWN_FIXTURE_GAPS = [/\/photo\.jpg$/, /\/tb-sprite\.svg$/, /broken-template/];
const unexpected = (paths: string[]) => paths.filter(p => !KNOWN_FIXTURE_GAPS.some(re => re.test(p)));

const buttonBg = (page: Page) =>
  page.frameLocator("#preview-frame").locator("button.df-button").first().evaluate(b => getComputedStyle(b).backgroundColor);

test.describe("static build — built without the audit (--no-audit)", () => {
  test("offers no Audit tab, falls back from a stored Audit tab, and never requests the audit", async ({ page }) => {
    // Same snapshot, with the shell's runtime saying the build left the audit out — what
    // `pd build --no-audit` writes into every shell page (asserted in dev-server's build test).
    await page.route("**/pd/atoms/button", async route => {
      const res = await route.fetch();
      const html = (await res.text()).replace('"mode":"static"', '"mode":"static","audit":false');
      await route.fulfill({ response: res, body: html });
    });
    await page.addInitScript(() => localStorage.setItem("pd-view-state", JSON.stringify({ panelTab: "audit" })));
    const auditRequests: string[] = [];
    page.on("request", r => { if (r.url().includes("audit.json")) auditRequests.push(r.url()); });

    await page.goto("atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");
    await expect(page.locator('.panel-tabs button[data-tab="docs"]')).toBeVisible();
    await expect(page.locator('.panel-tabs button[data-tab="audit"]')).toHaveCount(0);
    await expect(page.locator('.panel-tabs button[data-tab="docs"]')).toHaveAttribute("aria-selected", "true");
    expect(auditRequests).toEqual([]);
  });
});

test.describe("static build — the workbench without a server", () => {
  test("a deep link loads the shell, the tree and a preview that paints its CSS", async ({ page }) => {
    const seen = watch(page);
    await page.goto("atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await expect(page.locator(".rail-status")).toHaveAttribute("data-state", "static");
    await expect(page.locator(".rail-status")).toContainText("Static build");
    await expect(page.locator('.sidebar-tree a.tree-link[href="/pd/atoms/button"]')).toHaveAttribute("aria-current", "page");
    // Painted, not merely linked: the default theme's primary button colour (#0F6CBD).
    await expect.poll(() => buttonBg(page)).toBe("rgb(15, 108, 189)");

    expect(seen.outside).toEqual([]);
    expect(unexpected(seen.notFound)).toEqual([]);
    expect(seen.sockets).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test("tree links navigate in place, and a reload of the new URL works", async ({ page }) => {
    const seen = watch(page);
    await page.goto("atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");
    await page.click('.sidebar-tree a.tree-link[href="/pd/atoms/badge"]');
    await expect(page).toHaveURL(/\/pd\/atoms\/badge$/);
    await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", /data-component-id="atoms\/badge"/);

    await page.reload();
    await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", /data-component-id="atoms\/badge"/);
    expect(unexpected(seen.notFound)).toEqual([]);
  });

  test("a variant deep link and a theme switch both work from files", async ({ page }) => {
    await page.goto("atoms/button#secondary");
    await page.waitForSelector("#preview-frame[srcdoc]");
    await expect(page.locator(".variant-bar select")).toHaveValue("secondary");

    await page.goto("atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");
    await expect.poll(() => buttonBg(page)).toBe("rgb(15, 108, 189)");
    await page.evaluate(() => {
      const r = document.querySelector<HTMLInputElement>('input.theme-radio[value="brand-red"]')!;
      r.checked = true;
      r.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => buttonBg(page)).toBe("rgb(164, 38, 44)");
  });

  test("source views, folder overviews and the audit snapshot are served from the build", async ({ page }) => {
    const seen = watch(page);
    await page.goto("atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("[data-tab='html']");
    await expect(page.locator("#dock-panel-html pre")).toContainText("df-button");

    await page.click('.panel-tabs button[data-tab="audit"]');
    await expect(page.locator(".panel-content .audit-headline")).toContainText("machine-detectable static defects", { timeout: 10_000 });
    // The audit is the build's, not the current state's — and says so.
    await expect(page.locator(".panel-content .audit-panel")).toContainText("Snapshot from");

    await page.goto("atoms");
    await expect(page.locator(".gallery-item").first()).toBeVisible();
    await expect(page.locator('.gallery-item a[href="/pd/atoms/button"]')).toBeVisible();

    expect(seen.outside).toEqual([]);
    expect(unexpected(seen.notFound)).toEqual([]);
  });
});
