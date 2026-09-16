import { test, expect } from "@playwright/test";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const patternsDir = path.resolve(__dirname, "../../../test-bench/src/patterns/atoms");

// A fresh slug PER TEST, not per module.
//
// These were previously one module-level slug shared by all five tests, so every test created,
// deleted and re-created the same path. The watcher coalesces a rapid delete -> create -> delete
// on one path, so the final tree-changed for "deleting the active component" often never
// arrived: that test passed alone (277ms) and failed when run after its siblings. A path that is
// never reused removes the coalescing window entirely.
let SLUG!: string;
let compDir!: string;
let hbsPath!: string;
let siblingDir!: string;

let seq = 0;

async function waitForNavItem(page: import("@playwright/test").Page, id: string, present: boolean, timeout = 8_000) {
  const selector = `.sidebar-tree a[href="/${id}"]`;
  if (present) {
    await expect(page.locator(selector)).toBeAttached({ timeout });
  } else {
    await expect(page.locator(selector)).toHaveCount(0, { timeout });
  }
}

test.describe("live nav update — tree-changed HMR", () => {
  test.beforeEach(() => {
    SLUG = `live-nav-test-${Date.now()}-${seq++}`;
    compDir = path.join(patternsDir, SLUG);
    hbsPath = path.join(compDir, `${SLUG}.hbs`);
    siblingDir = path.join(patternsDir, `${SLUG}-sibling`);
  });

  test.afterEach(async () => {
    // Clean up both test fixtures unconditionally. These write into the real test-bench tree,
    // so a leaked fixture would dirty the working copy for everything downstream.
    await rm(compDir, { recursive: true, force: true }).catch(() => {});
    await rm(siblingDir, { recursive: true, force: true }).catch(() => {});
  });

  test("adding a .hbs adds the component to the nav", async ({ page }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Component does not exist yet.
    await waitForNavItem(page, `atoms/${SLUG}`, false);

    // Create the directory and .hbs.
    await mkdir(compDir, { recursive: true });
    await writeFile(hbsPath, `<div class="${SLUG}">live nav test</div>\n`);

    // Nav must gain the new item.
    await waitForNavItem(page, `atoms/${SLUG}`, true);
  });

  test("removing a component directory removes the item from the nav", async ({ page }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Add the component via HMR (same reliable path as the add test) so it appears in nav.
    await mkdir(compDir, { recursive: true });
    await writeFile(hbsPath, `<div class="${SLUG}">live nav test</div>\n`);
    await waitForNavItem(page, `atoms/${SLUG}`, true);

    // Remove the directory — unlinking just the .hbs leaves an empty dir (group node) in the tree.
    await rm(compDir, { recursive: true });

    // Nav must lose the item.
    await waitForNavItem(page, `atoms/${SLUG}`, false);
  });

  test("deleting the active component clears the preview without crashing", async ({ page }) => {
    // Open the shell first so the nav is observable, then create the component and wait for it
    // to appear. Navigating straight to /atoms/<slug> right after the write raced discovery: if
    // the watcher had not indexed the file yet the route 404s, no preview-frame is ever emitted
    // and the test times out at 30s. Waiting for the nav item proves discovery landed.
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await mkdir(compDir, { recursive: true });
    await writeFile(hbsPath, `<div class="${SLUG}">live nav test</div>\n`);
    await waitForNavItem(page, `atoms/${SLUG}`, true);

    // Navigate to the new component.
    await page.goto(`/atoms/${SLUG}`);
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Delete the directory while it's active.
    await rm(compDir, { recursive: true });

    // Nav item disappears (tree-changed was processed).
    await waitForNavItem(page, `atoms/${SLUG}`, false);

    // Preview and panel are hidden — no crash, no stale content.
    await expect(page.locator("#single-preview")).toHaveAttribute("hidden");
  });

  test("active highlight survives a tree-changed that doesn't affect the current component", async ({ page }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Confirm button is highlighted.
    await expect(page.locator('.sidebar-tree a[href="/atoms/button"][aria-current="page"]')).toBeAttached();

    // Add a sibling component.
    await mkdir(compDir, { recursive: true });
    await writeFile(hbsPath, `<div class="${SLUG}">sibling</div>\n`);
    await waitForNavItem(page, `atoms/${SLUG}`, true);

    // Button's highlight must survive the nav re-render.
    await expect(page.locator('.sidebar-tree a[href="/atoms/button"][aria-current="page"]')).toBeAttached();
  });

  test("open folders survive an unrelated tree change", async ({ page }) => {
    await page.goto("/");
    // Wait for the sidebar to render with at least atoms category.
    await expect(page.locator(".tree-node[data-path='atoms'] > .tree-folder-row > details.tree-details")).toBeVisible();

    const atoms     = page.locator(".tree-node[data-path='atoms']     > .tree-folder-row > details.tree-details");
    const molecules = page.locator(".tree-node[data-path='molecules'] > .tree-folder-row > details.tree-details");

    // Open TWO categories so we can verify neither collapses on a change in just one.
    if (!(await atoms.evaluate((d: HTMLDetailsElement) => d.open)))     await atoms.locator("summary").click();
    if (!(await molecules.evaluate((d: HTMLDetailsElement) => d.open))) await molecules.locator("summary").click();
    await expect(atoms).toHaveJSProperty("open", true);
    await expect(molecules).toHaveJSProperty("open", true);

    // Trigger tree-changed in atoms by adding a folder-per-component (flat .hbs won't appear).
    await mkdir(siblingDir, { recursive: true });
    await writeFile(path.join(siblingDir, `${SLUG}-sibling.hbs`), "<div>sibling</div>\n");

    // New node appearing proves the full round-trip (watch → ws → re-fetch → mountSidebar) landed.
    await waitForNavItem(page, `atoms/${SLUG}-sibling`, true);

    // BOTH categories must still be open — change in atoms must not collapse molecules.
    await expect(atoms).toHaveJSProperty("open", true);
    await expect(molecules).toHaveJSProperty("open", true);
  });
});
