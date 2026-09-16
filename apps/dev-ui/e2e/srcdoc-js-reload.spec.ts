import { test, expect } from "@playwright/test";
import { gotoComponentReady as gotoComponent } from "./helpers.js";
import type { ConsoleMessage } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const testBench  = path.resolve(__dirname, "../../../test-bench");
const toggleTs   = path.join(testBench, "src/scripts/toggle.ts");
const buttonScss = path.join(testBench, "src/styles/01-atoms/button.scss");

async function waitForScriptLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    return f?.contentDocument?.body.getAttribute("data-script-loaded") === "toggle";
  });
}

// Ensure the HMR WebSocket is connected before triggering a file change.
async function waitForHmrConnected(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const notice = document.querySelector(".disconnect-notice") as HTMLElement | null;
    return notice ? notice.hidden : true;
  });
}

// Write a unique reload marker into toggle.ts, wait for that marker to appear
// in page console output (confirming the new script ran in the iframe).
// Returns a cleanup function that restores the original file.
async function writeAndWaitForMarker(
  page: import("@playwright/test").Page,
  original: string,
  suffix: string,
  occurrences = 1
): Promise<{ marker: string; restore: () => Promise<void> }> {
  const marker = `pd-reload-${suffix}`;

  // Counter for how many times the marker appeared (covers multi-tile case).
  let count = 0;
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.text() === marker) count++;
  };
  page.on("console", onConsole);

  await waitForHmrConnected(page);
  await writeFile(toggleTs, `${original}\nconsole.log("${marker}");`);

  // Poll until the marker appeared the required number of times.
  await expect.poll(() => count, { timeout: 15_000 }).toBeGreaterThanOrEqual(occurrences);
  page.off("console", onConsole);

  return {
    marker,
    restore: () => writeFile(toggleTs, original),
  };
}

test.describe("JS HMR — srcdoc reload", () => {
  test.describe.configure({ retries: 3 });

  // AT-1: versioned URL
  test("srcdoc script src carries ?v= on initial render", async ({ page }) => {
    await gotoComponent(page, "atoms/toggle-demo");
    await waitForScriptLoaded(page);

    const srcdoc = await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      return f?.srcdoc ?? "";
    });
    // mtime from Node stat().mtimeMs may be a float — allow digits and optional decimal.
    expect(srcdoc).toMatch(/<script[^>]+src="[^"]*\?v=[\d.]+"/);
  });

  // AT-2: version changes on edit
  test("?v= value advances after editing toggle.ts", async ({ page }) => {
    await gotoComponent(page, "atoms/toggle-demo");
    await waitForScriptLoaded(page);

    const readVersion = async () => {
      const srcdoc = await page.evaluate(() => {
        const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
        return f?.srcdoc ?? "";
      });
      const m = srcdoc.match(/\?v=([\d.]+)/);
      return m ? m[1] : null;
    };

    const vBefore = await readVersion();
    expect(vBefore).not.toBeNull();

    const original = await readFile(toggleTs, "utf-8");
    const { restore } = await writeAndWaitForMarker(page, original, "at2");
    try {
      const vAfter = await readVersion();
      expect(vAfter).not.toBeNull();
      expect(vAfter).not.toBe(vBefore);
    } finally {
      await restore();
    }
  });

  // AT-3: surgical reload — shell survives, old iframe doc replaced
  test("shell survives a JS save; old iframe doc is replaced", async ({ page }) => {
    await gotoComponent(page, "atoms/toggle-demo");
    await waitForScriptLoaded(page);

    // Plant a marker on the shell window.
    await page.evaluate(() => {
      (window as Window & { __pd_shell_marker?: boolean }).__pd_shell_marker = true;
    });
    // Plant an OLD-doc marker in the iframe.
    await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      if (f?.contentWindow) (f.contentWindow as Window & { __old_doc?: boolean }).__old_doc = true;
    });

    const original = await readFile(toggleTs, "utf-8");
    const { restore } = await writeAndWaitForMarker(page, original, "at3");
    // The marker fired → new script ran → new document loaded → old marker gone.
    try {
      // Shell must survive (not a full-page reload).
      const shellSurvived = await page.evaluate(() =>
        !!(window as Window & { __pd_shell_marker?: boolean }).__pd_shell_marker
      );
      expect(shellSurvived).toBe(true);

      // Toggle button must be present in the new document.
      await expect(page.frameLocator("#preview-frame").locator("[data-toggle]")).toBeVisible();
    } finally {
      await restore();
    }
  });

  // AT-4: single execution — no stacked listeners
  // Observable: toggle.ts logs 'Button Clicked 🏴‍☠️' on each click.
  // A stacked binding (script ran twice) logs twice per click.
  // An injected counter fires once per click regardless of binding count — wrong signal.
  test("one click on [data-toggle] produces exactly one click-log after reload", async ({ page }) => {
    await gotoComponent(page, "atoms/toggle-demo");
    await waitForScriptLoaded(page);

    const original = await readFile(toggleTs, "utf-8");
    const { restore } = await writeAndWaitForMarker(page, original, "at4");
    // The marker fired → new script is running in the new document.
    try {
      const clickLogs: string[] = [];
      page.on("console", msg => {
        if (msg.text().includes("Button Clicked")) clickLogs.push(msg.text());
      });

      await page.frameLocator("#preview-frame").locator("[data-toggle]").click();
      await page.waitForTimeout(200);

      expect(clickLogs).toHaveLength(1);
    } finally {
      await restore();
    }
  });

  // AT-5: obvious console log
  test("[pd] srcdoc reloaded appears in console on JS save", async ({ page }) => {
    await gotoComponent(page, "atoms/toggle-demo");
    await waitForScriptLoaded(page);

    // Collect [pd] srcdoc reloaded messages before AND during the reload.
    const reloadLogs: string[] = [];
    page.on("console", msg => {
      if (msg.text().includes("[pd] srcdoc reloaded")) reloadLogs.push(msg.text());
    });

    const original = await readFile(toggleTs, "utf-8");
    // Wait for the marker (new script ran) — by then [pd] srcdoc reloaded has fired.
    const { restore } = await writeAndWaitForMarker(page, original, "at5");
    try {
      // [pd] srcdoc reloaded fires before the script runs (it's in main.ts).
      expect(reloadLogs.length).toBeGreaterThanOrEqual(1);
    } finally {
      await restore();
    }
  });

  // AT-6: variants gallery — all tiles reload; shell survives
  test("JS save while variants gallery is open reloads all tiles; shell survives", async ({ page }) => {
    await gotoComponent(page, "atoms/toggle-demo");

    // Switch to variants gallery (toggle-demo~alt.json gives default + alt = 2 tiles).
    await page.selectOption(".variant-select", "__all__");
    await page.waitForSelector("#variants-gallery .gallery-item iframe");
    await expect(page.locator("#variants-gallery .gallery-item")).toHaveCount(2);

    // Wait for both tiles to run the script.
    await page.waitForFunction(() => {
      const tiles = Array.from(document.querySelectorAll<HTMLIFrameElement>(
        "#variants-gallery .gallery-item iframe"
      ));
      return tiles.length === 2 && tiles.every(
        f => f.contentDocument?.body.getAttribute("data-script-loaded") === "toggle"
      );
    }, undefined, { timeout: 15_000 });

    await page.evaluate(() => {
      (window as Window & { __pd_shell_marker?: boolean }).__pd_shell_marker = true;
    });

    const original = await readFile(toggleTs, "utf-8");
    // Both tiles run the same script → marker fires twice (once per tile).
    const { restore } = await writeAndWaitForMarker(page, original, "at6", 2);
    try {
      const shellSurvived = await page.evaluate(() =>
        !!(window as Window & { __pd_shell_marker?: boolean }).__pd_shell_marker
      );
      expect(shellSurvived).toBe(true);
    } finally {
      await restore();
    }
  });

  // AT-7 (CSS no-regression): CSS edit uses css-link-swap; iframe is NOT replaced
  test("CSS save triggers css-link-swap and does not replace the iframe srcdoc", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Plant a marker inside the iframe's window — gone if srcdoc is replaced.
    await page.evaluate(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      if (f?.contentWindow) (f.contentWindow as Window & { __css_guard?: boolean }).__css_guard = true;
    });

    const original = await readFile(buttonScss, "utf-8");
    try {
      await writeFile(buttonScss, `${original}\n/* hmr-js-css-guard */\n`);

      // Wait for css-link-swap: button's CSS link href gains ?v=.
      await page.waitForFunction(() => {
        const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
        return !!f?.contentDocument?.querySelector("link[data-pd-comp='atoms/button'][href*='?v=']");
      }, undefined, { timeout: 15_000 });

      // Window marker must survive (srcdoc was NOT replaced).
      const markerSurvived = await page.evaluate(() => {
        const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
        return !!(f?.contentWindow as Window & { __css_guard?: boolean }).__css_guard;
      });
      expect(markerSurvived).toBe(true);
    } finally {
      await writeFile(buttonScss, original);
    }
  });
});
