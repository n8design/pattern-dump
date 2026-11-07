// Protocol version marker — the server announces PD_PROTOCOL_VERSION on every response header, on
// /api/version, and in the socket's first `hello` frame. A matching shell stays quiet about it.

import { test, expect } from "@playwright/test";
import { PD_PROTOCOL_HEADER, PD_PROTOCOL_VERSION } from "@pattern-dump/contracts";
import { gotoComponent } from "./helpers.js";

test.describe("protocol version marker", () => {
  test("every response carries the protocol header, and /api/version reports it", async ({ request }) => {
    for (const path of ["/api/version", "/api/tree", "/_pd/main.js", "/atoms/button"]) {
      const res = await request.get(path);
      expect(res.headers()[PD_PROTOCOL_HEADER.toLowerCase()], path).toBe(String(PD_PROTOCOL_VERSION));
    }
    const info = await (await request.get("/api/version")).json();
    expect(info.protocol).toBe(PD_PROTOCOL_VERSION);
  });

  test("a matching server produces no mismatch on the Console", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.click("#dock-tab-console");
    await expect(page.locator("#dock-panel-console .console p", { hasText: "HMR connected" })).toBeAttached();
    // The hello frame arrives right after open; give it a moment before asserting its absence.
    await page.waitForTimeout(500);
    await expect(page.locator("#dock-panel-console .console p", { hasText: "Protocol mismatch" })).toHaveCount(0);
    await expect(page.locator(".rail-status")).not.toHaveAttribute("data-state", "disconnected");
  });

  // page-changed is for storefront pages. The workbench receives every frame on the shared socket, so
  // it must ignore this one: no reload, no Console line, no tree rebuild, no preview swap. The socket
  // is proxied to the real server and the frames are injected into it; a tree-changed injected last
  // proves the injection reaches the shell, so the "nothing happened" above it is not an untested path.
  test("a page-changed frame leaves the workbench untouched", async ({ page }) => {
    let inject: ((frame: object) => void) | null = null;
    await page.routeWebSocket(/^ws:\/\/localhost:\d+\/?$/, ws => {
      const server = ws.connectToServer();
      ws.onMessage(m => server.send(m));
      server.onMessage(m => ws.send(m));
      inject = frame => ws.send(JSON.stringify(frame));
    });

    await gotoComponent(page, "atoms/button");
    await page.click("#dock-tab-console");
    const consoleLines = page.locator("#dock-panel-console .console p");
    await expect(consoleLines.filter({ hasText: "HMR connected" })).toBeAttached();
    await expect.poll(() => inject !== null).toBe(true);

    await page.evaluate(() => { (window as unknown as { __pdMarker: number }).__pdMarker = 1; });
    const link = await page.locator('.sidebar-tree a[href="/atoms/button"]').elementHandle();
    const srcdoc = await page.locator("#preview-frame").getAttribute("srcdoc");
    const lines = await consoleLines.count();

    inject!({ type: "page-changed", route: "/guides/setup/" });
    inject!({ type: "page-changed", route: null });
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => (window as unknown as { __pdMarker?: number }).__pdMarker)).toBe(1);
    expect(await link!.evaluate(el => el.isConnected)).toBe(true);
    expect(await page.locator("#preview-frame").getAttribute("srcdoc")).toBe(srcdoc);
    expect(await consoleLines.count()).toBe(lines);

    // The control: the same channel does reach the shell — tree-changed rebuilds the Nav Rail.
    inject!({ type: "tree-changed" });
    await expect.poll(() => link!.evaluate(el => el.isConnected)).toBe(false);
    await expect(page.locator('.sidebar-tree a[href="/atoms/button"]')).toBeAttached();
  });
});
