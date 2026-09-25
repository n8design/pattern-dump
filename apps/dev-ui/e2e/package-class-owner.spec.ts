// A project template that writes a package class directly gets the package component's CSS, even
// when a project base rule restyles that class in context.
//
// Fixture: atoms/pkg-class-use writes class="fixture-chip" (defined by pd-fixture-ui's
// atoms/fixture-chip: padding 0.25rem 0.5rem, 1px border). test-bench's 00-base/shared-family has
// `.tb-chip-host .fixture-chip`, a project base rule that only mentions the class. Before the fix
// that rule owned the class, so the chip's stylesheet was never linked and the span painted bare.
import { test, expect } from "@playwright/test";
import { gotoComponentReady } from "./helpers";

test("a package class used in a project template links the package component's CSS", async ({ page }) => {
  await gotoComponentReady(page, "atoms/pkg-class-use");
  const frame = page.frameLocator("#preview-frame");

  await expect(frame.locator('link[rel="stylesheet"][href*="/_pd/components/atoms/fixture-chip.css"]')).toHaveCount(1);

  // Verify on the painted element, not the served markup.
  const chip = frame.locator(".fixture-chip");
  await expect(chip).toHaveCSS("border-top-width", "1px");
  await expect(chip).toHaveCSS("padding-left", "8px");
});
