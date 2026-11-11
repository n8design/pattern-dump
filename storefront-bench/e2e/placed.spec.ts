// A component placed on a page with values (pd- tags), read on the rendered page: the slider and its slides
// are in the DOM, their stylesheets paint, and the caption's markdown is rendered. Live (pd dev) and built
// (pd build, from a static host): the same DOM is dom-parity's.
import { expect, test } from "./fixtures.js";

test("the guides page shows the slider placed on it, styled", async ({ page }) => {
  await page.goto("/guides/");
  const slider = page.locator(`section.slider[aria-label="The bench in pictures"]`);
  await expect(slider).toBeVisible();
  await expect(slider.locator(".slider-item")).toHaveCount(2);
  // The slider's stylesheet and the slides' (placed inside it) both paint.
  await expect(slider).toHaveCSS("display", "flex");
  await expect(slider.locator("figure.slide").first()).toHaveCSS("border-top-style", "solid");
  await expect(slider.locator("figure.slide img").first()).toHaveAttribute("alt", "Blocks of colour");
  // Content is markdown: rendered, with HTML escaped.
  await expect(slider.locator("figcaption").first().locator("strong")).toHaveText("wireframe");
  await expect(slider.locator("figcaption").nth(1).locator("code")).toHaveText("pd-");
});

