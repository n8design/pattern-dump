// A schema field named like a registered helper shows on its component: `{{id}}` would call PD's id helper,
// never read the field. The component is written into test-bench at test time and removed after.
import { test, expect } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { saveInTwoSteps } from "../../../test-support/save.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const atoms = path.resolve(__dirname, "../../../test-bench/src/patterns/atoms");
// A fresh folder per run, so the watcher never sees a path reused.
const SLUG = `helper-named-${Date.now()}`;
const dir = path.join(atoms, SLUG);

test.afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("a schema field named like a helper shows as SCHEMA_INVALID in the Diagnostics tab", async ({ page }) => {
  await page.goto("/atoms/button");
  await page.waitForSelector("#preview-frame[srcdoc]");
  await mkdir(dir, { recursive: true });
  await saveInTwoSteps(path.join(dir, `${SLUG}.schema.json`),
    JSON.stringify({ properties: { label: { type: "string" }, id: { type: "string" } } }));
  await saveInTwoSteps(path.join(dir, `${SLUG}.hbs`), `<p class="${SLUG}">{{label}}</p>\n`);
  await expect(page.locator(`.sidebar-tree a[href="/atoms/${SLUG}"]`)).toBeAttached({ timeout: 10_000 });

  await page.locator(`.sidebar-tree a[href="/atoms/${SLUG}"]`).click();
  await expect(page.frameLocator("#preview-frame").locator(`p.${SLUG}`)).toBeAttached();
  await page.click("[data-tab='diagnostics']");
  const item = page.locator("#dock-panel-diagnostics .diagnostics li[data-kind='SCHEMA_INVALID']");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(`"id" is the name of a registered helper, so {{id}} would call the helper, not read this field`);
  await expect(item.locator(".diag-sev")).toHaveText("Error");
});
