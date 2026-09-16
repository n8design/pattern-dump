import { test, expect } from "@playwright/test";

// Wait for the tree to be rendered and the active link to be set.
// aria-current is set only after navigate()/navigateOverview() completes.
async function waitForTree(page: import("@playwright/test").Page) {
  await page.waitForSelector(
    'a.tree-link[aria-current="page"], a.tree-show-all[aria-current="page"]'
  );
}

test.describe("navigation & tree", () => {
  test("deep-link sets aria-current and opens ancestor details", async ({ page }) => {
    // atoms/input is private — navigating directly auto-enables "Show private".
    await page.goto("/atoms/input");
    await waitForTree(page);

    // Active link must carry aria-current="page".
    const activeLink = page.locator('a.tree-link[aria-current="page"]');
    await expect(activeLink).toHaveAttribute("href", "/atoms/input");

    // The atoms <details> must be open so the link is visible.
    const atomsDetails = page.locator("details[data-depth='0']").first();
    await expect(atomsDetails).toHaveAttribute("open", "");
  });

  test("folder overview route renders the gallery", async ({ page }) => {
    await page.goto("/atoms");
    await page.waitForSelector(".gallery");

    await expect(page.locator(".gallery")).toBeVisible();
    await expect(page.locator(".gallery-item").first()).toBeVisible();
  });

  test("show-all navigates to overview; summary toggle toggles without navigating", async ({ page }) => {
    await page.goto("/molecules/field");
    await waitForTree(page);

    // No standalone "Overview" child row — show-all lives in the folder summary.
    await expect(page.locator(".tree-overview")).toHaveCount(0);

    // The show-all link for molecules is in its summary.tree-folder.
    const showAllLink = page.locator('a.tree-show-all[aria-label="Show all Molecules"]');
    await expect(showAllLink).toBeVisible();

    // Clicking show-all navigates to the folder overview.
    await showAllLink.click();
    await expect(page).toHaveURL("/molecules");
    await page.waitForSelector(".gallery");
    await expect(page.locator(".gallery")).toBeVisible();

    // Navigate back; verify summary keyboard toggle — does not navigate.
    await page.goto("/molecules/field");
    await waitForTree(page);

    // Target molecules specifically by data-path (avoids ambiguity with other open sections).
    const moleculesDetails = page.locator('li.tree-node[data-path="molecules"] details.tree-details');
    await expect(moleculesDetails).toHaveAttribute("open", "");

    // Focus and space-toggle the summary — keyboard avoids accidentally triggering show-all.
    const moleculesSummary = moleculesDetails.locator("summary.tree-folder");
    await moleculesSummary.focus();
    await page.keyboard.press("Space");

    // Details is now closed; URL did NOT change.
    await expect(moleculesDetails).not.toHaveAttribute("open", "");
    await expect(page).toHaveURL("/molecules/field");
  });

  test("summary and show-all link are keyboard-reachable", async ({ page }) => {
    await page.goto("/atoms/button");
    await waitForTree(page);

    // atoms details is open because we navigated to a component inside it.
    const atomsDetails = page.locator("details[data-depth='0']").first();
    await expect(atomsDetails).toHaveAttribute("open", "");

    // Summary is focusable and operable via keyboard.
    const atomsSummary = atomsDetails.locator("summary.tree-folder");
    await atomsSummary.focus();
    await expect(atomsSummary).toBeFocused();

    // Space closes the details.
    await page.keyboard.press("Space");
    await expect(atomsDetails).not.toHaveAttribute("open", "");

    // Space re-opens.
    await page.keyboard.press("Space");
    await expect(atomsDetails).toHaveAttribute("open", "");

    // Show-all link is focusable and navigates via keyboard Enter.
    const showAllLink = page.locator('a.tree-show-all[aria-label="Show all Atoms"]');
    await showAllLink.focus();
    await expect(showAllLink).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/atoms");
  });

  test("show-internals toggle reveals private components", async ({ page }) => {
    // Start at a public atom — atoms section is expanded, no auto-enable of show-internals.
    await page.goto("/atoms/button");
    await waitForTree(page);

    // atoms/input is a private leaf component. The entire <li> (including its link)
    // must be absent when "Show private" is off.
    const inputNode = page.locator('.tree-node[data-path="atoms/input"]');
    await expect(inputNode).not.toBeVisible();

    // Checking "Show private" reveals atoms/input with its private badge.
    const checkbox = page.locator(".show-internals-check");
    await checkbox.check();
    await expect(inputNode).toBeVisible();
    await expect(inputNode.locator(".private-badge")).toBeVisible();

    // Unchecking hides it again.
    await checkbox.uncheck();
    await expect(inputNode).not.toBeVisible();
  });

  test("tree-folder rows are sticky", async ({ page }) => {
    await page.goto("/atoms/button");
    await waitForTree(page);

    // .tree-folder-row is the sticky element; summary.tree-folder is inside it.
    const folderRow = page.locator(".tree-folder-row").first();
    const position = await folderRow.evaluate(
      (el) => getComputedStyle(el).position
    );
    expect(position).toBe("sticky");
  });
});

test.describe("SPA navigation — URL as source of truth", () => {
  test("relation click pushes URL and updates all regions", async ({ page }) => {
    await page.goto("/molecules/field");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // Click the input relation anchor.
    await page.click("a.rel-link[href='/atoms/input']");
    await page.waitForURL(/atoms\/input/);

    // URL was pushed to the new component.
    await expect(page).toHaveURL(/atoms\/input/);

    // Caption (breadcrumb) updated.
    await expect(page.locator(".preview-caption")).toHaveText("atoms/input");

    // Preview iframe re-pointed — not left stale (direct contentDocument access; frameLocator lags CDP after srcdoc change).
    await page.waitForFunction(
      () => !!document.getElementById("preview-frame")?.contentDocument?.querySelector("main[data-component-id='atoms/input']"),
      undefined,
      { timeout: 10000 }
    );

    // Relationships panel updated for the new component.
    await expect(page.locator(".rel-panel")).toBeVisible();
  });

  test("browser Back re-renders all regions to match the prior URL", async ({ page }) => {
    await page.goto("/molecules/field");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // Capture history length before navigation — exactly ONE entry must be added.
    const lenBefore = await page.evaluate(() => history.length);

    await page.click("a.rel-link[href='/atoms/input']");
    await page.waitForURL(/atoms\/input/);
    await expect(page.locator(".preview-caption")).toHaveText("atoms/input");

    // Exactly ONE new history entry per navigation (no iframe joint-history pollution).
    const lenAfter = await page.evaluate(() => history.length);
    expect(lenAfter).toBe(lenBefore + 1);

    // Real browser Back — works because iframe navigation no longer adds history entries.
    await page.goBack();

    // SPA re-renders all regions for /molecules/field after back navigation.
    // Anchored regex distinguishes "molecules/field" from "atoms/input".
    await expect(page.locator(".preview-caption")).toHaveText(/^molecules\/field$/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/molecules\/field/);
    // Preview iframe must be re-pointed to molecules/field, not left stale.
    await page.waitForFunction(
      () => !!document.getElementById("preview-frame")?.contentDocument?.querySelector("main[data-component-id='molecules/field']"),
      undefined,
      { timeout: 10000 }
    );
  });

  test("HTML tab fetches the correct component's rendered HTML after Back navigation", async ({ page }) => {
    // Scenario: view molecules/field → SPA-navigate to atoms/input via relation link →
    // goBack() → switch to HTML tab → verify field's rendered HTML is shown, not stale input HTML.
    // applyComponent() clears renderedHtmlCache on every navigation; the tab must re-fetch.
    await page.goto("/molecules/field");
    await page.waitForSelector("#preview-frame[srcdoc]");

    // Navigate SPA-style into atoms/input via the relation link in the facet panel.
    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");
    await page.click("a.rel-link[href='/atoms/input']");
    await page.waitForURL(/\/atoms\/input/, { timeout: 10000 });
    await expect(page.locator(".preview-caption")).toHaveText("atoms/input");

    // Open the HTML tab on atoms/input — triggers fetchAndShowHtml for atoms/input.
    await page.click("button[data-tab='html']");
    const htmlBody = page.locator("#dock-panel-html .source-body");
    await expect(htmlBody).not.toBeEmpty({ timeout: 10000 });
    // atoms/input renders only <input class="df-input"…> — no df-field wrapper.
    await expect(htmlBody).toContainText("df-input");
    await expect(htmlBody).not.toContainText("df-field");

    // Browser Back → SPA loads molecules/field; applyComponent clears HTML cache + resets to source.
    await page.goBack();
    await expect(page).toHaveURL(/\/molecules\/field/, { timeout: 10000 });
    await expect(page.locator(".preview-caption")).toHaveText(/^molecules\/field$/, { timeout: 10000 });

    // Switch to HTML tab — must re-fetch molecules/field's rendered HTML, not show stale input HTML.
    await page.click("button[data-tab='html']");
    await expect(htmlBody).not.toBeEmpty({ timeout: 10000 });
    // molecules/field renders <div class="df-field">…</div> — distinct from atoms/input.
    await expect(htmlBody).toContainText("df-field");
  });

  test("sidebar link pushes URL and updates all regions", async ({ page }) => {
    // Start at atoms/icon so the atoms section is already open in the sidebar,
    // making the atoms/button link visible without needing to expand it.
    await page.goto("/atoms/icon");
    await page.waitForSelector("#preview-frame[srcdoc]");
    await waitForTree(page);

    // atoms/button is visible because the atoms details is already open.
    await page.click("a.tree-link[href='/atoms/button']");
    await page.waitForURL(/\/atoms\/button/);

    await expect(page.locator(".preview-caption")).toHaveText("atoms/button");
    // Preview iframe re-pointed — not left stale.
    await page.waitForFunction(
      () => !!document.getElementById("preview-frame")?.contentDocument?.querySelector("main[data-component-id='atoms/button']"),
      undefined,
      { timeout: 10000 }
    );
    // Sidebar active item updated.
    await expect(
      page.locator("a.tree-link[href='/atoms/button']")
    ).toHaveAttribute("aria-current", "page");
  });
});
