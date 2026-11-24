// `pd build --browser` without a browser (browser-checks.ts): a project without Playwright, and a Playwright whose
// Chromium won't start, stop the build with a named error before anything is written. And who closes the browser: the
// checks take one passed in and leave it open; the build launches it and closes it once, whether the checks pass or
// throw. The checks in a real Chromium run with the E2E suites (storefront-bench/e2e/build-browser.spec.ts), where a
// browser is installed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
// From the source, not the built package: the build must close the browser this source launches.
import { buildStaticSite } from "../src/static-build.js";
import { BrowserUnavailableError, launchChromium, loadProjectPlaywright, runBrowserChecks, type PlaywrightModule } from "../src/storefront/browser-checks.js";
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
    await expect(launchChromium(playwright))
      .rejects.toThrow("pd build --browser couldn't start Chromium (Executable doesn't exist at /x/chrome): npm install --save-dev playwright, then npx playwright install chromium");
  });

  it("stops the build before anything is built or written", async () => {
    const config = validateConfig(defineConfig({ outDir: "./.out/wb", storefront: { pagesDir: "./pages", outDir: "./.out/site", workbenchUrl: "https://wb.test/" } }), "test");
    await expect(buildStaticSite(config, root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test", browser: true }))
      .rejects.toThrow("pd build --browser needs Playwright in this project");
    expect(existsSync(join(root, ".out"))).toBe(false);
  });
});

/** A Playwright whose Chromium opens pages and finds nothing on them, counting launches and closes; with `failing`, its
 *  first context can't be made, so the checks throw. */
function fakePlaywright(failing = false) {
  const counts = { launched: 0, closed: 0 };
  const page = {
    goto: async () => null, fill: async () => {}, press: async () => {}, waitForTimeout: async () => {},
    addScriptTag: async () => null, evaluate: async () => [] as never,
  };
  const browser = {
    newContext: async () => {
      if (failing) throw new Error("no context");
      return { route: async () => {}, newPage: async () => page, close: async () => {} };
    },
    close: async () => { counts.closed++; },
  };
  const playwright: PlaywrightModule = { chromium: { launch: async () => { counts.launched++; return browser; } } };
  return { playwright, browser, counts };
}

describe("who closes the browser", () => {
  it("the checks leave the browser they were given open", async () => {
    const { browser, counts } = fakePlaywright();
    const checked = await runBrowserChecks({ pages: ["/"], get: () => Promise.reject(new Error("not reached")), browser });
    expect(checked).toEqual({ errors: [], a11yWarnings: [], images: [] });
    expect(counts.closed).toBe(0);
  });

  const config = () => validateConfig(defineConfig({ outDir: "./.out/wb", storefront: { pagesDir: "./pages", outDir: "./.out/site", workbenchUrl: "https://wb.test/" } }), "test");

  it("the build launches it once and closes it once", async () => {
    const { playwright, counts } = fakePlaywright();
    await buildStaticSite(config(), root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test", browser: true, loadPlaywright: async () => playwright });
    expect(counts).toEqual({ launched: 1, closed: 1 });
    await rm(join(root, ".out"), { recursive: true, force: true });
  });

  it("the build closes it when the checks throw, and writes nothing", async () => {
    const { playwright, counts } = fakePlaywright(true);
    await expect(buildStaticSite(config(), root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test", browser: true, loadPlaywright: async () => playwright }))
      .rejects.toThrow("no context");
    expect(counts).toEqual({ launched: 1, closed: 1 });
    expect(existsSync(join(root, ".out"))).toBe(false);
  });
});
