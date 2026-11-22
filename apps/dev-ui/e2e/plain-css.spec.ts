// A plain .css file in the styles folder belongs to the component it is named after, as a .scss file does.
//
// Fixture: atoms/plain-css writes class="tb-plain-css"; its rules are in 01-atoms/_plain-css.css, a plain CSS
// partial that 01-atoms/plain-css-bundle.scss loads with @use. Before the fix the .css origin matched no component,
// so the rules went to the base layer only and the span painted bare.
import { test, expect } from "@playwright/test";
import { gotoComponentReady } from "./helpers";

test("a component styled by a plain .css partial paints with it", async ({ page }) => {
  await gotoComponentReady(page, "atoms/plain-css");
  const frame = page.frameLocator("#preview-frame");

  await expect(frame.locator('link[rel="stylesheet"][href*="/_pd/components/atoms/plain-css.css"]')).toHaveCount(1);

  // Verify on the painted element, not the served markup.
  const span = frame.locator(".tb-plain-css");
  await expect(span).toHaveCSS("border-top-width", "2px");
  await expect(span).toHaveCSS("padding-left", "8px");
});
