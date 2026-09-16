// The static-mode mapping, exercised by loading the module with a `window.__pd` in place.

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function load(runtime?: unknown) {
  vi.stubGlobal("window", runtime ? { __pd: runtime } : {});
  return import("./runtime.js");
}

describe("runtime — live", () => {
  it("leaves every URL as the dev server knows it", async () => {
    const r = await load({ mode: "live", wsPort: 4001 });
    expect(r.isStatic).toBe(false);
    expect(r.auditAvailable).toBe(true);
    expect(r.resourceUrl("/api/component/atoms/button?variant=ghost")).toBe("/api/component/atoms/button?variant=ghost");
    expect(r.routeHref("/atoms/button")).toBe("/atoms/button");
    expect(r.routeFromPathname("/atoms/button")).toBe("/atoms/button");
  });
});

describe("runtime — static under a subpath", () => {
  const snapshot = { mode: "static", basePath: "docs/htwoo", builtAt: "2026-09-16T10:00:00Z", pdVersion: "0.1.0" };

  it("maps requests to snapshot files under the base path", async () => {
    const r = await load(snapshot);
    expect(r.basePath).toBe("/docs/htwoo/");
    expect(r.resourceUrl("/api/component/atoms/button?variant=ghost")).toBe("/docs/htwoo/api/component/atoms/button/~ghost.json");
    expect(r.resourceUrl("/preview/atoms/button?theme=dark")).toBe("/docs/htwoo/preview/atoms/button/index.html");
    expect(r.resourceUrl("/_pd/themes/dark.css")).toBe("/docs/htwoo/_pd/themes/dark.css");
    expect(r.resourceUrl("https://cdn.example/x.js")).toBe("https://cdn.example/x.js");
  });

  it("offers the audit unless the build left it out", async () => {
    expect((await load(snapshot)).auditAvailable).toBe(true);
    vi.unstubAllGlobals(); vi.resetModules();
    expect((await load({ ...snapshot, audit: false })).auditAvailable).toBe(false);
  });

  it("prefixes routes and strips the prefix from the location", async () => {
    const r = await load(snapshot);
    expect(r.routeHref("/atoms/button")).toBe("/docs/htwoo/atoms/button");
    expect(r.routeHref("/")).toBe("/docs/htwoo/");
    expect(r.routeFromPathname("/docs/htwoo/atoms/button")).toBe("/atoms/button");
    expect(r.routeFromPathname("/docs/htwoo/")).toBe("/");
  });
});
