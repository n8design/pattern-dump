// The workbench and the live-reload generation (core/generation.ts): a document that was taken before a
// change the shell has since heard of is fetched again, and a document older than the one a frame shows
// never replaces it. A response is held in the route after the server has produced it, so which one is
// older does not depend on timing. The spec writes into test-bench and restores it after each test.
import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PD_GENERATION_HEADER, generationBehind } from "@pattern-dump/contracts";
import { gotoComponent } from "./helpers.js";

const testBench = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../test-bench");
const ICON = path.join(testBench, "src/patterns/atoms/icon/icon.hbs");
const BUTTON = path.join(testBench, "src/patterns/atoms/button/button.json");
const originals = new Map<string, string>();

test.beforeEach(async () => { for (const f of [ICON, BUTTON]) originals.set(f, await readFile(f, "utf8")); });
test.afterEach(async ({ page }) => {
  const before = await serverGeneration(page);
  for (const [f, text] of originals) await writeFile(f, text);
  // Let the restores be handled before the next spec.
  await expect.poll(async () => generationBehind(before, await serverGeneration(page)), { timeout: 10_000 }).toBe(true);
});

const serverGeneration = async (page: Page) => (await page.request.get("/api/version")).headers()[PD_GENERATION_HEADER.toLowerCase()];
const srcdoc = (page: Page) => page.locator("#preview-frame").getAttribute("srcdoc");

/** Hold the first response to `pattern`, after the server has produced it, until released. */
async function holdFirst(page: Page, pattern: string) {
  let release = (): void => {};
  let produced = (_generation: string): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetched = new Promise<string>(resolve => { produced = resolve; });
  let held = false;
  await page.route(pattern, async (route: Route) => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    produced(response.headers()[PD_GENERATION_HEADER.toLowerCase()] ?? "");
    await gate;
    return route.fulfill({ response });
  });
  return { fetched, release: () => release() };
}

test("a component opened while it changed is fetched again: its preview is the changed one", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  // The detail navigation fetches for atoms/icon is produced, then held.
  const hold = await holdFirst(page, "**/api/component/atoms/icon");
  await page.locator('.sidebar-tree a.tree-link[href="/atoms/icon"]').click();
  const generation = await hold.fetched;

  // The change, handled meanwhile: its reload names atoms/icon, which is not yet the open component.
  await writeFile(ICON, `${originals.get(ICON)}<b class="zz-generation">changed while opening</b>\n`);
  await expect.poll(async () => generationBehind(generation, await serverGeneration(page)), { timeout: 10_000 }).toBe(true);

  hold.release();
  // The held detail is from before the change; the shell has heard of a newer generation and fetches again.
  await expect.poll(() => srcdoc(page), { timeout: 10_000 }).toContain("changed while opening");
  await page.unrouteAll({ behavior: "wait" });
});

test("an older preview response never replaces a newer one: two quick saves, the first resolving last", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  const data = JSON.parse(originals.get(BUTTON)!) as Record<string, unknown>;
  // The first save's preview is produced, then held.
  const hold = await holdFirst(page, "**/preview/atoms/button*");
  await writeFile(BUTTON, JSON.stringify({ ...data, label: "First save" }));
  await hold.fetched;

  // Every document the frame is given, in order: the end state alone would not show a stale document that
  // was put in and then fetched again.
  await page.evaluate(() => {
    const frame = document.getElementById("preview-frame")!;
    const shown: string[] = [];
    (window as unknown as { shown: string[] }).shown = shown;
    new MutationObserver(() => { shown.push(frame.getAttribute("srcdoc") ?? ""); })
      .observe(frame, { attributes: true, attributeFilter: ["srcdoc"] });
  });
  // The second save's preview goes through and is shown.
  await writeFile(BUTTON, JSON.stringify({ ...data, label: "Second save" }));
  await expect.poll(() => srcdoc(page), { timeout: 10_000 }).toContain("Second save");

  // The first one arrives last, and is dropped: it is older than what the frame shows, so the frame is
  // never given it.
  hold.release();
  await page.waitForTimeout(1_000);
  const shown = await page.evaluate(() => (window as unknown as { shown: string[] }).shown);
  const second = shown.findIndex(doc => doc.includes("Second save"));
  expect(second).toBeGreaterThanOrEqual(0);
  expect(shown.slice(second).filter(doc => doc.includes("First save"))).toEqual([]);
  await page.unrouteAll({ behavior: "wait" });
});
