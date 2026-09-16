// Nav Rail — theme picker widget.
//
// Coverage before this file: the widget itself had none. Existing tests drive the theme STATE
// machine (persistence, ?theme=, fullpage live-sync) or set data-theme directly on the iframe body,
// bypassing the UI. interaction.spec.ts:254 was the only test that made the picker cause a change,
// and it dispatches `change` programmatically rather than exercising the control.
//
// Note on keyboard: `.theme-picker-list` carries role="radiogroup", but setupRadiogroupKeyboard
// (main.ts:2865) is only ever called on the CVD group and the viewport toolbar -- never here. The
// picker uses NATIVE <input type="radio"> with a shared name, so arrow-key navigation and roving
// tabindex come from the browser. These tests assert the resulting behaviour, not the mechanism.
//
// Two facts about the real widget that these tests are built on, both verified rather than assumed:
//
//   1. The radios are SR-ONLY (_rail.scss:79 -- clip-path: inset(50%), 1px box). They are focusable
//      but not clickable, so the user-facing affordance is the chip <label>. Playwright's .check()
//      cannot act on them; clicking the label is both the honest path and the working one.
//   2. store.local.theme defaults to "" (store.ts:161), so on a FRESH load no radio is checked and
//      the summary reads "— no theme —" -- even though test-bench's config declares default: light.
//      The picker reflects shell state, not the project's default theme.

import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

const list = ".theme-picker-list";
const radios = `${list} input.theme-radio`;

async function openPicker(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    document.querySelector<HTMLDetailsElement>("details.theme-picker")!.open = true;
  });
  await expect(page.locator(list)).toBeVisible();
}

test.describe("Nav Rail — theme picker", () => {
  const chip = (name: string) => `${list} label[aria-label="${name}"]`;

  test("fresh load: the picker shows the theme actually in effect", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openPicker(page);

    await expect(page.locator(radios)).not.toHaveCount(0);

    // The preview is ALWAYS themed: with no ?theme= the server falls back to its configured default
    // (routes.ts:303-311), so the body carries data-theme="light". The picker used to read
    // "— no theme —" with nothing checked, describing shell state while claiming to describe the
    // document. It now reports what the user is looking at.
    await expect(page.locator(".theme-picker-current-name")).toHaveText("light");
    await expect(page.locator(`${radios}:checked`)).toHaveValue("light");
  });

  test("the picker's readout matches the rendered preview body", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openPicker(page);

    // THE invariant that was broken. Verified on the rendered DOM, not on stored state: whatever
    // the picker claims must equal the data-theme the preview document is actually using.
    const shown = await page.locator(".theme-picker-current-name").textContent();
    await expect(page.frameLocator("#preview-frame").locator("body"))
      .toHaveAttribute("data-theme", shown!.trim());
  });

  test("clicking a chip selects that theme and applies it to the preview", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openPicker(page);

    await page.click(chip("brand-blue"));

    await expect(page.locator(`${radios}:checked`)).toHaveValue("brand-blue");
    await expect(page.locator(".theme-picker-current-name")).toHaveText("brand-blue");
    // Verified on the rendered preview document, not on stored state.
    await expect(page.frameLocator("#preview-frame").locator("body"))
      .toHaveAttribute("data-theme", "brand-blue");
  });

  test("arrow keys move the selection and apply it (native radiogroup behaviour)", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openPicker(page);

    const values = await page.locator(radios).evaluateAll(
      (els) => els.map((e) => (e as HTMLInputElement).value),
    );
    expect(values.length).toBeGreaterThan(1);

    await page.click(chip(values[0]!));
    await expect(page.locator(".theme-picker-current-name")).toHaveText(values[0]!);

    // The sr-only input is focusable even though it is not clickable.
    await page.locator(`${radios}[value="${values[0]}"]`).focus();
    await page.keyboard.press("ArrowDown");

    await expect(page.locator(`${radios}:checked`)).toHaveValue(values[1]!);
    await expect(page.locator(".theme-picker-current-name")).toHaveText(values[1]!);
    await expect(page.frameLocator("#preview-frame").locator("body"))
      .toHaveAttribute("data-theme", values[1]!);
  });

  test("the readout announces the hovered theme, then restores the active one", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openPicker(page);

    await page.click(chip("brand-blue"));
    await expect(page.locator(".theme-picker-readout")).toHaveText("brand-blue");

    await page.hover(chip("brand-red"));
    await expect(page.locator(".theme-picker-readout")).toHaveText("brand-red");

    // Leaving restores the ACTIVE theme, not the last hovered one -- aria-live must not lie.
    await page.hover(".theme-picker-summary");
    await expect(page.locator(".theme-picker-readout")).toHaveText("brand-blue");
  });

  test("each chip is labelled, so the swatch is not the only affordance", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await openPicker(page);

    const labels = page.locator(`${list} label.theme-swatch-chip`);
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(labels.nth(i)).toHaveAttribute("aria-label", /.+/);
    }
  });
});
