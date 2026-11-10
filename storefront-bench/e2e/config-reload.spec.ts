// pd dev takes a storefront.site change in its config live: the open page reloads with the new value. Any
// other change asks for a restart on the open page, and a config that does not load says so; the page keeps
// its values in both. The spec edits the bench's config and restores it after each test.
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { save } from "../../test-support/save.js";

const config = fileURLToPath(new URL("../pattern-dump.config.ts", import.meta.url));
const FOOTER = "Built with Pattern Dump from the storefront bench.";
let original = "";

test.beforeEach(async () => { original = await readFile(config, "utf8"); });
// Restored, and waited for until pd dev serves the original values again: the next test's save would
// otherwise be read by the restore's handling, and the restore never taken.
test.afterEach(async ({ request }) => {
  await save(config, original);
  await expect.poll(async () => /<footer[\s\S]*?<p>([^<]*)<\/p>/.exec(await (await request.get("/about/")).text())?.[1],
    { timeout: 10_000 }).toBe(FOOTER);
});

test.describe("the config file in pd dev", () => {
  test("a storefront.site edit shows on the open page", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.locator(".site-footer p").first()).toHaveText(FOOTER);
    await save(config, original.replace(`footer: "${FOOTER}"`, `footer: "A footer edited while the page was open."`));
    await expect(page.locator(".site-footer p").first()).toHaveText("A footer edited while the page was open.", { timeout: 10_000 });
  });

  test("any other edit asks for a restart, and the page keeps its values", async ({ page }) => {
    await page.goto("/about/");
    await save(config, original
      .replace(`footer: "${FOOTER}"`, `footer: "Not taken."`)
      .replace(`outDir: "./.out/workbench"`, `outDir: "./.out/workbench-elsewhere"`));
    await expect(page.locator("[data-pd-live-notice] li")).toHaveText(
      ["pattern-dump.config.ts changed: restart pd dev to load it (only storefront.site is taken without a restart)"], { timeout: 10_000 });
    await expect(page.locator(".site-footer p").first()).toHaveText(FOOTER);
  });

  test("a config that does not load is reported, and the page keeps its values", async ({ page }) => {
    await page.goto("/about/");
    // An unknown key at the top of the config (inside storefront.site any key is the skin's to check, per page).
    await save(config, original
      .replace(`footer: "${FOOTER}"`, `footer: "Not taken either."`)
      .replace(`sourceDir: "./src",`, `sourceDir: "./src",\n  bogus: 1,`));
    await expect(page.locator("[data-pd-live-notice] li")).toContainText(
      "pattern-dump.config.ts cannot be loaded, so pd dev keeps running with the config it has", { timeout: 10_000 });
    await expect(page.locator(".site-footer p").first()).toHaveText(FOOTER);
  });
});
