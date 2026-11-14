// A data field a helper shadows shows on its component: `{{id}}` inside `{{#each palettes}}` calls PD's id helper,
// so each palette's "id" is never read (no schema needed). The component is written into test-bench at test time and
// removed after.
import { test, expect } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { saveInTwoSteps } from "../../../test-support/save.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const atoms = path.resolve(__dirname, "../../../test-bench/src/patterns/atoms");
// A fresh folder per run, so the watcher never sees a path reused.
const SLUG = `helper-shadow-${Date.now()}`;
const dir = path.join(atoms, SLUG);

test.afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("a data field a helper shadows shows as HELPER_SHADOW in the Diagnostics tab", async ({ page }) => {
  await page.goto("/atoms/button");
  await page.waitForSelector("#preview-frame[srcdoc]");
  await mkdir(dir, { recursive: true });
  await saveInTwoSteps(path.join(dir, `${SLUG}.json`), JSON.stringify({ palettes: [{ id: "retro", label: "Retro" }] }));
  await saveInTwoSteps(path.join(dir, `${SLUG}.hbs`), `<ul class="${SLUG}">{{#each palettes}}<li class="p-{{id}}">{{label}}</li>{{/each}}</ul>\n`);
  await expect(page.locator(`.sidebar-tree a[href="/atoms/${SLUG}"]`)).toBeAttached({ timeout: 10_000 });

  await page.locator(`.sidebar-tree a[href="/atoms/${SLUG}"]`).click();
  await expect(page.frameLocator("#preview-frame").locator(`ul.${SLUG} li`)).toHaveText("Retro");
  await page.click("[data-tab='diagnostics']");
  const item = page.locator("#dock-panel-diagnostics .diagnostics li[data-kind='HELPER_SHADOW']");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(`{{id}} calls the helper "id", so the data's "palettes[].id" is never read here`);
  await expect(item.locator(".diag-sev")).toHaveText("Warning");
});
