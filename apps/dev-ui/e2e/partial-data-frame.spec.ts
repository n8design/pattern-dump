// Included partials keep the caller's data frame (stock Handlebars): `@root` inside a partial is the
// page's data, and `{{#if @partial-block}}` sees the block body of a block call.
//
// Fixtures: atoms/tb-root-list loops crew and includes atoms/tb-root-reader, which prints
// `{{@root.listTitle}}`. atoms/tb-guarded-caller calls atoms/tb-guarded-block with and without a block.
import { test, expect } from "@playwright/test";
import { gotoComponentReady } from "./helpers";

test("@root inside a partial included in #each is the page's data", async ({ page }) => {
  await gotoComponentReady(page, "atoms/tb-root-list");
  const items = page.frameLocator("#preview-frame").locator(".tb-root-item");
  await expect(items).toHaveText(["Ada of Crew list", "Grace of Crew list"]);
});

test("{{#if @partial-block}} renders the block for a block call and the fallback otherwise", async ({ page }) => {
  await gotoComponentReady(page, "atoms/tb-guarded-caller");
  const guarded = page.frameLocator("#preview-frame").locator(".tb-guarded");
  await expect(guarded).toHaveCount(2);
  await expect(guarded.nth(0).locator(".tb-guarded-body")).toHaveText("block body");
  await expect(guarded.nth(1)).toHaveText("no block");
});
