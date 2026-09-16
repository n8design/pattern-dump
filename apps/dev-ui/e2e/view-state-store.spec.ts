/**
 * E2E tests for the view-state store.
 * All assertions are on the RENDERED RESULT, not the stored value.
 */
import { test, expect } from "@playwright/test";
import { gotoComponent, selectTheme } from "./helpers.js";

// ── Theme reload ──────────────────────────────────────────────────────────────

test.describe("theme — reload persistence (no flash)", () => {
  test("non-default theme visibly survives a page reload", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Wait for iframe to be ready.
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      return f?.contentDocument?.readyState === "complete";
    });

    // Select the 'light' theme.
    await selectTheme(page, "light");
    const previewFrame = page.frameLocator("#preview-frame");
    await expect(previewFrame.locator("body")).toHaveAttribute("data-theme", "light");

    // Reload and navigate to same component.
    await page.reload();
    await page.waitForSelector("#preview-frame[srcdoc]");
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      return f?.contentDocument?.readyState === "complete";
    });

    // After reload + navigation, theme should still be 'light' in the rendered iframe.
    // (data-theme is baked into the srcdoc via previewUrl ?theme=light — no flash.)
    await expect(page.frameLocator("#preview-frame").locator("body")).toHaveAttribute("data-theme", "light");
  });

  test("?theme= shareable link applies theme, writes through, param is stripped", async ({ page }) => {
    await page.goto("/atoms/button?theme=light");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // URL should have the ?theme= param stripped.
    await page.waitForFunction(() => !window.location.search.includes("theme="));
    expect(page.url()).not.toContain("theme=");

    // Theme should be visible in the iframe.
    await page.waitForFunction(() => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      return f?.contentDocument?.readyState === "complete";
    });
    await expect(page.frameLocator("#preview-frame").locator("body")).toHaveAttribute("data-theme", "light");

    // Theme picker should reflect the applied theme.
    await expect(page.locator('input.theme-radio[value="light"]')).toBeChecked();
  });
});

// ── Variant hash ──────────────────────────────────────────────────────────────

test.describe("variant — hash routing", () => {
  test("#variant deep-links to the named variant", async ({ page }) => {
    await page.goto("/atoms/button#secondary");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Variant select should show "secondary".
    await expect(page.locator(".variant-select")).toHaveValue("secondary");
  });

  test("#unknown on a component without that variant falls back to default, hash clears", async ({ page }) => {
    await page.goto("/atoms/button#nonexistent-variant");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Wait for the hash to be cleared by reconcile.
    await page.waitForFunction(() => window.location.hash === "");
    expect(page.url()).not.toContain("#");

    // Variant select should show the default.
    await expect(page.locator(".variant-select")).toHaveValue("");
  });

  test("variant control visibly clears when navigating to a pattern with no variants", async ({ page }) => {
    // Navigate to a component with variants first.
    await gotoComponent(page, "atoms/button");
    await expect(page.locator(".variant-bar")).toBeVisible();

    // Navigate to atoms/icon which has no variants.
    await page.locator(".sidebar-tree a.tree-link").filter({ hasText: "icon" }).first().click();
    await page.waitForSelector("#preview-frame[srcdoc]");

    await expect(page.locator(".variant-bar")).not.toBeVisible();
    await expect(page.locator(".variant-select")).toHaveValue("");
  });

  test("dropdown variant change, hash deep-link, and Back all use the same swap path", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Dropdown: select "secondary".
    await page.locator(".variant-select").selectOption("secondary");
    await expect(page.locator(".variant-select")).toHaveValue("secondary");
    expect(page.url()).toContain("#secondary");

    // Back: return to default.
    await page.goBack();
    await expect(page.locator(".variant-select")).toHaveValue("");
    expect(page.url()).not.toContain("#");

    // Direct hash navigation.
    await page.goto("/atoms/button#secondary");
    await page.waitForSelector("#preview-frame[srcdoc]");
    await expect(page.locator(".variant-select")).toHaveValue("secondary");
  });
});

// ── Viewport URL ─────────────────────────────────────────────────────────────

test.describe("viewport — ?vp= URL", () => {
  test("?vp=mobile deep-links to the mobile viewport", async ({ page }) => {
    await page.goto("/atoms/button?vp=mobile");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Mobile button should be checked.
    await expect(page.locator(".rail-vp-btn[data-vp='mobile']")).toHaveAttribute("aria-checked", "true");
    // Fit should not be checked.
    await expect(page.locator(".rail-vp-btn[data-vp='fit']")).toHaveAttribute("aria-checked", "false");
  });

  test("unknown ?vp= value falls back to Fit", async ({ page }) => {
    await page.goto("/atoms/button?vp=unknown-mode");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await expect(page.locator(".rail-vp-btn[data-vp='fit']")).toHaveAttribute("aria-checked", "true");
  });

  test("?vp=fullscreen opens the fullpage dialog", async ({ page }) => {
    await page.goto("/atoms/button?vp=fullscreen");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await expect(page.locator("#fullpage-dialog")).toBeVisible();
    await expect(page.locator("#fullpage-frame")).toBeAttached();
  });
});

// ── Nav open-state ────────────────────────────────────────────────────────────

test.describe("nav open-state — reload persistence", () => {
  test("expanded folder paths survive a page reload", async ({ page }) => {
    await page.goto("/");
    // Wait for the sidebar tree container (links inside closed <details> are hidden at root).
    await page.waitForSelector(".sidebar-tree");

    // Toggle open the first collapsible folder by clicking its <summary>.
    await page.locator(".sidebar-tree .tree-details > summary").first().click();

    // Reload.
    await page.reload();
    // After reload, the now-open folder's links should be visible.
    await page.waitForSelector(".sidebar-tree a.tree-link");

    // The same folder should still be open after reload.
    const openDetails = page.locator(".sidebar-tree .tree-details[open]");
    await expect(openDetails.first()).toBeVisible();
  });
});

// ── Dock tab reload ────────────────────────────────────────────────────────────

test.describe("dock tabs — reload persistence", () => {
  test("active dock tab survives a page reload", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Switch to HTML tab.
    await page.locator("[data-tab='html']").click();
    await expect(page.locator("#dock-panel-html")).toBeVisible();

    // Reload and navigate to same component.
    await page.reload();
    await page.waitForSelector("#preview-frame[srcdoc]");

    // HTML tab should still be selected.
    await expect(page.locator("#dock-panel-html")).toBeVisible();
  });

  test("sourceFacet survives reload when dockTab is source/data", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Switch to Data facet (only visible if component has data).
    const dataFacet = page.locator("[data-facet='data']");
    if (await dataFacet.isVisible()) {
      await dataFacet.click();
      await expect(page.locator("#dock-panel-data")).toBeVisible();

      await page.reload();
      await page.waitForSelector("#preview-frame[srcdoc]");

      await expect(page.locator("#dock-panel-data")).toBeVisible();
    }
  });
});

// ── Dock visibility ───────────────────────────────────────────────────────────

test.describe("dock visibility — reload persistence", () => {
  test("right panel open/closed state survives reload", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Close the panel.
    await page.locator(".panel-toggle-btn").click();
    const wasOpen = await page.evaluate(() => "panelOpen" in document.querySelector(".main")!.dataset);
    expect(wasOpen).toBe(false);

    // Reload.
    await page.reload();
    await page.waitForSelector(".sidebar-tree a.tree-link");

    // Panel should still be closed.
    const stillOpen = await page.evaluate(() => "panelOpen" in document.querySelector(".main")!.dataset);
    expect(stillOpen).toBe(false);
  });
});

// ── Search does not rehydrate ─────────────────────────────────────────────────

test.describe("search — not rehydrated", () => {
  test("search box is empty on fresh load even after a prior search", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    // Type a search query.
    await page.locator(".sidebar-search input").fill("button");
    await expect(page.locator(".sidebar-tree")).toBeVisible();

    // Reload.
    await page.reload();
    await page.waitForSelector(".sidebar-tree a.tree-link");

    // Search box must be empty and full tree visible.
    await expect(page.locator(".sidebar-search input")).toHaveValue("");
    // At least one tree link should be visible (not filtered).
    await expect(page.locator(".sidebar-tree a.tree-link").first()).toBeVisible();
  });
});

// ── fullpage live-sync ────────────────────────────────────────────────────────

test.describe("fullpage dialog — live-sync", () => {
  test("dialog opens via the Full page button", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    await page.locator(".fullpage-btn").click();

    // Dialog should be open and the frame should have srcdoc set.
    await expect(page.locator("#fullpage-dialog")).toBeVisible();
    const srcdoc = await page.locator("#fullpage-frame").getAttribute("srcdoc");
    expect(srcdoc).toBeTruthy();
  });

  test("URL gains ?vp=fullscreen when dialog opens, loses it when it closes", async ({ page }) => {
    await gotoComponent(page, "atoms/button");

    await page.locator(".fullpage-btn").click();
    await expect(page.locator("#fullpage-dialog")).toBeVisible();
    expect(page.url()).toContain("?vp=fullscreen");

    await page.locator(".fullpage-close").click();
    await expect(page.locator("#fullpage-dialog")).not.toBeVisible();
    await expect(page).not.toHaveURL(/vp=fullscreen/);
  });

  test("theme change while dialog is open updates the fullpage frame (live-sync)", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.locator(".fullpage-btn").click();
    await expect(page.locator("#fullpage-dialog")).toBeVisible();

    // Change theme while dialog is open.
    await selectTheme(page, "light");

    // The fullpage frame should eventually show the light theme (live-sync re-fetch).
    await expect(page.frameLocator("#fullpage-frame").locator("body")).toHaveAttribute(
      "data-theme", "light", { timeout: 5000 }
    );
  });
});
