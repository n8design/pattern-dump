// Overview tiles and a component's stylesheet appearing or emptying. A tile links only components with CSS,
// so a tile rendered while a component's CSS was empty has no link for it; when that CSS becomes non-empty
// (cssBecameNonEmpty on its css-link-swap), the tile reloads and gains it. The other way round, a tile keeps
// a link to CSS that is now empty: the keyed update points it at the empty sheet, which styles nothing and
// breaks nothing. The spec writes into test-bench and restores it after each test.
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PD_GENERATION_HEADER, generationBehind } from "@pattern-dump/contracts";

const testBench = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../test-bench");
const CHIP_SCSS = path.join(testBench, "src/styles/01-atoms/chip.scss");
const BUTTON_SCSS = path.join(testBench, "src/styles/01-atoms/button.scss");
let buttonScss = "";

const serverGeneration = async (page: Page) => (await page.request.get("/api/version")).headers()[PD_GENERATION_HEADER.toLowerCase()];
/** Wait until a change made now has been handled: the server's generation moves past `before`. */
const handled = async (page: Page, before: string | undefined) =>
  expect.poll(async () => generationBehind(before, await serverGeneration(page)), { timeout: 10_000 }).toBe(true);
/** The overview tile showing `id`. */
const tile = (page: Page, id: string): FrameLocator =>
  page.frameLocator(`#category-overview figure:has(a.gallery-label-link[href="/${id}"]) iframe`);

test.beforeEach(async () => { buttonScss = await readFile(BUTTON_SCSS, "utf8"); });
test.afterEach(async ({ page }) => {
  const before = await serverGeneration(page);
  await rm(CHIP_SCSS, { force: true });
  await writeFile(BUTTON_SCSS, buttonScss);
  await handled(page, before);
});

test("a tile rendered while a component had no CSS gains its stylesheet on the first non-empty save", async ({ page }) => {
  await page.goto("/atoms");
  const chip = tile(page, "atoms/chip");
  await expect(chip.locator(".pd-chip")).toBeVisible();
  await expect(chip.locator('link[data-pd-comp="atoms/chip"]')).toHaveCount(0);

  const before = await serverGeneration(page);
  await writeFile(CHIP_SCSS, ".pd-chip {\n  color: rgb(9, 8, 7);\n}\n");
  await handled(page, before);
  await expect(chip.locator('link[data-pd-comp="atoms/chip"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(chip.locator(".pd-chip")).toHaveCSS("color", "rgb(9, 8, 7)");
});

test("a tile keeps a harmless link when a component's CSS becomes empty", async ({ page }) => {
  await page.goto("/atoms");
  const button = tile(page, "atoms/button");
  const link = button.locator('link[data-pd-comp="atoms/button"]');
  await expect(link).toHaveCount(1);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));

  const before = await serverGeneration(page);
  await writeFile(BUTTON_SCSS, "// emptied\n");
  await handled(page, before);
  // The keyed update points the link at the now-empty sheet; the tile still renders, unstyled by it.
  await expect.poll(async () => (await link.getAttribute("href")) ?? "", { timeout: 10_000 }).toMatch(/\?v=\d+/);
  const sheet = await page.request.get((await link.getAttribute("href"))!);
  expect([sheet.status(), (await sheet.text()).trim()]).toEqual([200, ""]);
  await expect(button.locator(".df-button").first()).toBeVisible();
  expect(errors).toEqual([]);
});
