// Inspector panel — Docs facet.
//
// Coverage before this file: ZERO behavioural tests. `panel-content`, "No Documentation found" and
// "Select a component to view docs" appeared nowhere in the suite; the Docs tab was referenced only
// as a collapse/expand toggle in layout.spec.ts and a11y.spec.ts. Nothing asserted that documentation
// ever renders.
//
// Characterisation net for the main.ts decomposition: renderPanel (main.ts:1710) is a three-branch
// switch whose ORDER is load-bearing -- the audit branch sits deliberately above the `!current`
// guard, because the corpus facet is selection-independent. A code move must preserve that.

import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

const PANEL_TAB = (name: string) => `.panel-tabs button[data-tab="${name}"]`;
const panelContent = ".panel-content";

test.describe("Inspector — Docs facet", () => {
  test("renders documentation for a component that has a .md", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.click(PANEL_TAB("docs"));

    // test-bench/src/patterns/atoms/button/button.md exists, so real rendered markdown must appear.
    const content = page.locator(panelContent);
    await expect(content).not.toBeEmpty();
    // Server-rendered markdown-it output -- at minimum a heading or paragraph, never the empty state.
    await expect(content.locator("h1, h2, h3, p")).not.toHaveCount(0);
    await expect(content.locator(".doc-empty")).toHaveCount(0);
  });

  test("renders the empty state for a component with no .md", async ({ page }) => {
    await gotoComponent(page, "atoms/contrast-fail");
    await page.click(PANEL_TAB("docs"));

    const empty = page.locator(`${panelContent} .doc-empty`);
    await expect(empty).toBeAttached();
    await expect(empty).toHaveText("No Documentation found");
  });

  test("docs follow the selection when navigating between components", async ({ page }) => {
    await gotoComponent(page, "atoms/contrast-fail");
    await page.click(PANEL_TAB("docs"));
    await expect(page.locator(`${panelContent} .doc-empty`)).toBeAttached();

    // Navigating to a documented component must replace the empty state with real content.
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");
    await expect(page.locator(`${panelContent} .doc-empty`)).toHaveCount(0);
    await expect(page.locator(panelContent).locator("h1, h2, h3, p")).not.toHaveCount(0);
  });

  test("switching away to Relationships and back re-renders the docs", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.click(PANEL_TAB("docs"));

    // A distinctive phrase from the rendered docs, used as the presence probe. Taken from the live
    // render rather than hardcoded, so editing button.md does not break this test.
    const docsText = (await page.locator(panelContent).innerText()).trim().split("\n")[0];
    expect(docsText.length).toBeGreaterThan(0);

    await page.click(PANEL_TAB("relationships"));
    await expect(page.locator(PANEL_TAB("relationships"))).toHaveAttribute("aria-selected", "true");
    // The docs really went away -- otherwise "coming back" below would prove nothing.
    await expect(page.locator(panelContent)).not.toContainText(docsText);

    await page.click(PANEL_TAB("docs"));
    await expect(page.locator(PANEL_TAB("docs"))).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(panelContent)).toContainText(docsText);
  });
});
