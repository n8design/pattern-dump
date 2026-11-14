// `pd build --browser` without a browser (browser-checks.ts): a project without Playwright, and a Playwright whose
// Chromium won't start, stop the build with a named error before anything is written. The checks in a real Chromium
// run with the E2E suites (storefront-bench/e2e/build-browser.spec.ts), where a browser is installed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { BrowserUnavailableError, loadProjectPlaywright, runBrowserChecks } from "../src/storefront/browser-checks.js";
import { save } from "../../../test-support/save.js";

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-browser-checks-"));
  for (const [rel, text] of Object.entries({
    "src/patterns/layouts/page/page.hbs": `<header><p>S</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "pages/index.md": "---\ntitle: Home\n---\n\nText.\n",
  })) await save(join(root, rel), text);
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("pd build --browser without a browser", () => {
  it("names what to install when the project has no Playwright", async () => {
    await expect(loadProjectPlaywright(root)).rejects.toThrow(new BrowserUnavailableError(
      "pd build --browser needs Playwright in this project: npm install --save-dev playwright, then npx playwright install chromium"));
  });

  it("names what to install when Chromium won't start", async () => {
    const playwright = { chromium: { launch: () => Promise.reject(new Error("Executable doesn't exist at /x/chrome\nmore")) } };
    await expect(runBrowserChecks({ pages: ["/"], get: () => Promise.reject(new Error("not reached")), playwright }))
      .rejects.toThrow("pd build --browser couldn't start Chromium (Executable doesn't exist at /x/chrome): npm install --save-dev playwright, then npx playwright install chromium");
  });

  it("stops the build before anything is built or written", async () => {
    const config = validateConfig(defineConfig({ outDir: "./.out/wb", storefront: { pagesDir: "./pages", outDir: "./.out/site", workbenchUrl: "https://wb.test/" } }), "test");
    await expect(buildStaticSite(config, root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test", browser: true }))
      .rejects.toThrow("pd build --browser needs Playwright in this project");
    expect(existsSync(join(root, ".out"))).toBe(false);
  });
});
