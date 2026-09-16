// "Hide packages": pattern-package components leave the Nav Rail and folder galleries while staying
// usable. test-bench consumes the pd-fixture-ui package (test-bench/packages/pd-fixture-ui) through
// `packages` in its config: `atoms/fixture-chip` sits in a category test-bench also has, and
// `kit/fixture-card` in a category only the package has.

import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

const node = (path: string) => `.sidebar-tree .tree-node[data-path="${path}"]`;
const toggle = ".hide-packages-check";

test.describe("Nav Rail — Hide packages", () => {
  test.beforeEach(async ({ page }) => {
    // Every test starts from the default (packages shown), whatever an earlier test stored.
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("pd-e2e-hide-packages-reset")) {
        localStorage.removeItem("pd-view-state");
        sessionStorage.setItem("pd-e2e-hide-packages-reset", "1");
      }
    });
  });

  test("the control is offered because the tree has package components; package nodes are marked", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await expect(page.locator(".hide-packages-label")).toBeVisible();
    await expect(page.locator(toggle)).not.toBeChecked();
    await expect(page.locator(node("atoms/fixture-chip"))).toHaveAttribute("data-package", "");
    await expect(page.locator(node("atoms/button"))).not.toHaveAttribute("data-package", /.*/);
    await expect(page.locator(node("kit"))).toHaveAttribute("data-package", "");
    await expect(page.locator(node("atoms"))).not.toHaveAttribute("data-package", /.*/);
  });

  test("hiding removes package components and package-only categories, keeps mixed ones, and restores", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await expect(page.locator(node("kit"))).toBeVisible();

    await page.check(toggle);
    await expect(page.locator(node("kit"))).toBeHidden();
    await expect(page.locator(node("atoms/fixture-chip"))).toBeHidden();
    await expect(page.locator(node("atoms"))).toBeVisible();
    await expect(page.locator(node("atoms/button"))).toBeVisible();

    await page.uncheck(toggle);
    await expect(page.locator(node("kit"))).toBeVisible();
  });

  test("the choice survives a reload", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.check(toggle);
    await page.reload();
    await page.waitForSelector(node("atoms/button"));
    await expect(page.locator(toggle)).toBeChecked();
    await expect(page.locator(node("kit"))).toBeHidden();
  });

  test("a package component stays usable: it renders inside another component, and opening it reveals packages", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.check(toggle);

    await gotoComponent(page, "kit/fixture-card");
    await expect(page.frameLocator("#preview-frame").locator(".fixture-card .fixture-chip")).toHaveText("Package chip");
    await expect(page.locator(toggle)).not.toBeChecked();
    await expect(page.locator(node("kit/fixture-card"))).toBeVisible();
  });

  test("folder galleries hide package items too", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.check(toggle);
    await page.goto("/atoms");
    await page.waitForSelector(".gallery-item");
    await expect(page.locator('.gallery-item[data-package="pd-fixture-ui"]')).toBeHidden();
    await expect(page.locator(".gallery-item").filter({ has: page.locator('a[href="/atoms/button"]') })).toBeVisible();
  });
});
