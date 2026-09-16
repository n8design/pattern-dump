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
});
