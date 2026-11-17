// A change the server makes after the workbench has loaded, but before its live-reload socket opens, is announced to
// no one: the shell connects the socket only once the first view is on screen. The `hello` the server sends on
// connect says how far its changes have got (core/generation.ts); when that is past the tree the shell loaded, the
// shell loads the tree again, and the open view with it.
//
// The window is made certain, not left to timing: the page's socket is held until the server has handled the save
// (its generation has moved on), then let through. This is the case behind hmr.spec's folder index.md test failing
// now and then on CI's slower runner. The spec writes into test-bench and restores it after each test.
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PD_GENERATION_HEADER, generationBehind } from "@pattern-dump/contracts";
import { save } from "../../../test-support/save.js";

const testBench = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../test-bench");
const INDEX = path.join(testBench, "src/patterns/molecules/index.md");
let original = "";

const serverGeneration = async (page: Page) => (await page.request.get("/api/version")).headers()[PD_GENERATION_HEADER.toLowerCase()];

test.beforeEach(async () => { original = await readFile(INDEX, "utf8"); });
test.afterEach(async ({ page }) => {
  const before = await serverGeneration(page);
  await save(INDEX, original);
  // Let the restore be handled before the next spec.
  await expect.poll(async () => generationBehind(before, await serverGeneration(page)), { timeout: 10_000 }).toBe(true);
});

test("a change made before the live-reload socket opens still reaches the Nav Rail and the open folder page", async ({ page }) => {
  // Hold the socket: the page's connection waits until `release` is called.
  let release!: () => void;
  const released = new Promise<void>(r => { release = r; });
  await page.routeWebSocket(/^ws:/, async ws => { await released; ws.connectToServer(); });

  await page.goto("/molecules");
  await expect(page.locator(".overview-doc")).toContainText("Composite components", { timeout: 10_000 });

  // The change, handled by the server while the page has no socket: its generation moves on.
  const before = await serverGeneration(page);
  await save(INDEX, original.replace("title: Molecules", "title: Molecules HMR").replace("Composite components", "HMR_CONNECT_SMOKE composite components"));
  await expect.poll(async () => generationBehind(before, await serverGeneration(page)), { timeout: 10_000 }).toBe(true);
  await expect(page.locator(".sidebar")).not.toContainText(/Molecules HMR/i);

  // The socket opens; its hello is newer than the tree the page loaded.
  release();
  await expect(page.locator(".sidebar")).toContainText(/Molecules HMR/i, { timeout: 10_000 });
  await expect(page.locator(".overview-doc")).toContainText("HMR_CONNECT_SMOKE", { timeout: 10_000 });
});
