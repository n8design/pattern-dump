import { test, expect } from "@playwright/test";
import { gotoComponentReady as gotoComponent } from "./helpers.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testBench = path.resolve(__dirname, "../../../test-bench");

/**
 * Wait for a restore write's OWN watcher event to land before the spec finishes.
 *
 * Restoring a file in `finally` is not the end of the disturbance — it fires another chokidar
 * event, so a re-render and an HMR broadcast are still in flight when the test returns. At
 * workers:1 that lands in the NEXT spec, which for this file is interaction.spec.ts navigating to
 * atoms/button — the very component mutated here. Measured: that produced a ~1-in-10 failure where
 * interaction.spec's first gotoComponent timed out with an empty <main>.
 *
 * Swallows its own failure: this is cleanup, and it must never mask the real assertion error.
 */
async function settleAfterRestore(
  page: import("@playwright/test").Page,
  check: () => Promise<boolean>,
): Promise<void> {
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await page.waitForTimeout(100);
    }
  } catch { /* cleanup only — never mask the test's own failure */ }
}

test.describe("HMR smoke", () => {
  test.describe.configure({ retries: 2 });
  test("css-link-swap updates the component link href without reloading the iframe", async ({
    page,
  }) => {
    await gotoComponent(page, "atoms/button");

    // Plant a marker in the iframe's window so we can detect a reload.
    const previewFrame = page.frameLocator("#preview-frame");
    await previewFrame.locator("body").evaluate(() => {
      (window as Window & { __no_reload_marker?: boolean }).__no_reload_marker = true;
    });

    // Record the original href of the button's per-component CSS link.
    const originalHref = await previewFrame.locator("link[data-pd-comp='atoms/button']").getAttribute("href");
    expect(originalHref).toBeTruthy();

    const scssPath = path.join(
      testBench,
      "src/styles/01-atoms/button.scss"
    );
    const original = await readFile(scssPath, "utf-8");

    try {
      // Append a harmless rule to trigger the HMR css-link-swap path.
      await writeFile(scssPath, `${original}\n/* hmr-css-smoke */ .df-button { outline-offset: 2px; }\n`);

      // Wait for the link href to change (cache-buster appended by css-link-swap).
      await previewFrame.locator("link[data-pd-comp='atoms/button']").waitFor({ state: "attached", timeout: 10_000 });
      await page.waitForFunction(() => {
        const f = document.getElementById("preview-frame") as HTMLIFrameElement;
        const link = f?.contentDocument?.querySelector("link[data-pd-comp='atoms/button']") as HTMLLinkElement | null;
        return link?.href?.includes("?v=") ?? false;
      }, undefined, { timeout: 10_000 });

      // Confirm the iframe was NOT reloaded (window marker survives).
      const markerIntact = await previewFrame.locator("body").evaluate(() => {
        return !!(window as Window & { __no_reload_marker?: boolean }).__no_reload_marker;
      });
      expect(markerIntact).toBe(true);
    } finally {
      const hrefBeforeRestore = await previewFrame
        .locator("link[data-pd-comp='atoms/button']").getAttribute("href").catch(() => null);
      await writeFile(scssPath, original);
      // The restore recompiles and swaps the link again; wait for that second swap.
      await settleAfterRestore(page, async () => {
        const href = await previewFrame
          .locator("link[data-pd-comp='atoms/button']").getAttribute("href").catch(() => null);
        return !!href && href !== hrefBeforeRestore;
      });
    }
  });

  test("content-swap re-renders the preview iframe", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Modify the JSON data file — "Action" is the label value there, not in the HBS template.
    // JSON changes trigger content-swap just like HBS changes.
    const jsonPath = path.join(
      testBench,
      "src/patterns/atoms/button/button.json"
    );
    const original = await readFile(jsonPath, "utf-8");

    try {
      // Make a visible change to the label so the rendered HTML differs.
      await writeFile(jsonPath, original.replace("Action", "Action HMR_SMOKE"));

      // HMR content-swap sets iframe.srcdoc — assert the new text appears in the iframe.
      await expect(
        page.frameLocator("#preview-frame").locator("main")
      ).toContainText("HMR_SMOKE", { timeout: 10_000 });
    } finally {
      await writeFile(jsonPath, original);
      // The restore re-renders; wait for the marker to disappear so the next spec does not load
      // atoms/button while this component is mid-swap.
      await settleAfterRestore(page, async () => {
        const text = await page.frameLocator("#preview-frame").locator("main")
          .textContent().catch(() => null);
        return text !== null && !text.includes("HMR_SMOKE");
      });
    }
  });

  test("editing a component .md updates the Docs tab without a page reload", async ({ page }) => {
    await gotoComponent(page, "atoms/chip");
    await page.getByRole("tablist", { name: "Panel tabs" }).getByRole("tab", { name: "Docs" }).click();
    await page.evaluate(() => { (window as Window & { __no_reload_marker?: boolean }).__no_reload_marker = true; });

    const mdPath = path.join(testBench, "src/patterns/atoms/chip/chip.md");
    const original = await readFile(mdPath, "utf-8");
    try {
      await writeFile(mdPath, `${original}\nHMR_DOCS_SMOKE\n`);
      await expect(page.locator(".panel-content")).toContainText("HMR_DOCS_SMOKE", { timeout: 10_000 });
      expect(await page.evaluate(() => !!(window as Window & { __no_reload_marker?: boolean }).__no_reload_marker)).toBe(true);
    } finally {
      await writeFile(mdPath, original);
      await settleAfterRestore(page, async () =>
        !((await page.locator(".panel-content").textContent().catch(() => "")) ?? "").includes("HMR_DOCS_SMOKE"));
    }
  });

  test("editing a folder index.md updates the Nav Rail title and the open folder page", async ({ page }) => {
    await page.goto("/molecules");
    await expect(page.locator(".overview-doc")).toContainText("Composite components", { timeout: 10_000 });

    const mdPath = path.join(testBench, "src/patterns/molecules/index.md");
    const original = await readFile(mdPath, "utf-8");
    try {
      await writeFile(mdPath, original.replace("title: Molecules", "title: Molecules HMR").replace("Composite components", "HMR_FOLDER_SMOKE composite components"));
      await expect(page.locator(".sidebar")).toContainText(/Molecules HMR/i, { timeout: 10_000 });
      await expect(page.locator(".overview-doc")).toContainText("HMR_FOLDER_SMOKE", { timeout: 10_000 });
    } finally {
      await writeFile(mdPath, original);
      await settleAfterRestore(page, async () =>
        !((await page.locator(".sidebar").textContent().catch(() => "")) ?? "").match(/Molecules HMR/i));
    }
  });
});
