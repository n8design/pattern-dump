// A code block's copy button on a storefront page: the page's own script shows it and copies the block's code, from
// pd dev and from the built site. With scripting off there is no button to reach, so no focus stop that does nothing.
import { expect, test } from "./fixtures.js";

const CODE = "npm run dev --workspace storefront-bench\n";

test.describe("a code block's copy button", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("is shown, is in the Tab order, and copies the block's code", async ({ page }) => {
    await page.goto("/guides/setup/");
    const block = page.locator("main .shiki-container").filter({ hasText: "npm run dev" });
    const button = block.locator("button.copy-btn");
    await expect(button).toBeVisible();
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(button).toHaveText("Copied");
    // Said to a screen reader too: the button's name stays "Copy source", so the outcome goes to a polite live region.
    await expect(page.locator('[role="status"][aria-live="polite"]').filter({ hasText: "Copied" })).toHaveCount(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
    await expect(button).toHaveText("Copy");
  });
});

/** A skin's own rule that would show a hidden copy button. */
const FORCE_VISIBLE = ".copy-btn { display: inline-block !important; }";

test.describe("without a clipboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); });
  });

  test("there is no button, not even one a skin's CSS forces visible", async ({ page }) => {
    await page.goto("/guides/setup/");
    await page.addStyleTag({ content: FORCE_VISIBLE });
    await expect(page.locator("main .shiki-container").filter({ hasText: "npm run dev" })).toHaveCount(1);
    await expect(page.locator("main button.copy-btn")).toHaveCount(0);
  });
});

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the block has no button, and the block itself still takes focus", async ({ page }) => {
    await page.goto("/guides/setup/");
    const block = page.locator("main .shiki-container").filter({ hasText: "npm run dev" });
    // Not even a hidden one: the markup has none, so no skin's CSS can show it.
    await expect(page.locator("main button.copy-btn")).toHaveCount(0);
    // Tab from the block's previous focusable element lands on the block, not on a button.
    await block.locator("pre").focus();
    await expect(block.locator("pre")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.matches("button.copy-btn") ?? false)).toBe(false);
  });
});
