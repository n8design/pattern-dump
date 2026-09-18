// Unmatched paths: the SPA shell is served for workbench routes only. Everything else is a 404, so
// a broken asset path shows up as a failed request instead of a 200 carrying the workbench's HTML.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";

const here      = dirname(fileURLToPath(import.meta.url));
const testBench = join(here, "../../../test-bench");

const config = defineConfig({
  sourceDir:   "./src",
  patternsDir: "./src/patterns",
  outDir:      "./dist",
  styles:      { strategy: "parallel", dir: "./src/styles" },
  themes:      { dir: "./themes", default: "light", switch: "attribute" },
  assets:      { strategy: "central", dir: "./assets" },
  scriptsDir:  "./src/scripts",
});

/** What a browser sends for a page navigation, and for an image. */
const NAVIGATE = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const IMAGE    = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

describe("unmatched paths", () => {
  let server: { port: number; close: () => Promise<void> };
  const get = (path: string, accept = "*/*") =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { accept } });
  const isShell = async (res: Response) =>
    res.status === 200 && (await res.text()).includes(`<div id="app">`);

  beforeAll(async () => {
    server = await startDevServer(config, testBench, { port: 0, wsPort: 0 });
  }, 60_000);
  afterAll(async () => { await server?.close(); });

  it("a missing file outside the reserved prefixes is a 404", async () => {
    for (const path of ["/images/a.svg", "/definitely/missing.png", "/atoms/photo.jpg"]) {
      expect((await get(path, IMAGE)).status, path).toBe(404);
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it("an unmatched path under a reserved prefix is a 404, even for a navigation", async () => {
    for (const path of ["/_pd/nope.css", "/_pd/components/../x.png", "/api/nope", "/source/nope", "/assets/nope.svg"]) {
      const res = await get(path, NAVIGATE);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain(`<div id="app">`);
    }
  });

  it("workbench routes still get the shell, with or without a browser Accept header", async () => {
    for (const path of ["/", "/atoms/button", "/atoms", "/pages/homepage"]) {
      expect(await isShell(await get(path, NAVIGATE)), path).toBe(true);
      expect(await isShell(await get(path)), path).toBe(true);
    }
  });

  it("a navigation to a route whose last segment has a dot still gets the shell", async () => {
    // Component ids come from file names, so `card.small.hbs` is the route /molecules/card.small.
    expect(await isShell(await get("/molecules/card.small", NAVIGATE))).toBe(true);
  });
});
