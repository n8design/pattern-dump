// The package bench's built storefront on a plain static host (port 4900): every page and every preview it
// embeds is a file the host serves, and in a browser the pages render the packages' components with their
// compiled helpers, styles, asset and script, and no live client.
import { expect, test } from "@playwright/test";

const NO_CACHE = { "Cache-Control": "no-cache", Pragma: "no-cache" };

test.describe("the built package bench on a static host", () => {
  for (const path of ["/", "/about/", "/preview/molecules/card", "/preview/atoms/chip~strong"]) {
    test(`serves ${path}`, async ({ request }) => {
      const res = await request.get(path, { headers: NO_CACHE });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/html");
      expect(await res.text()).not.toContain("data-pd-live");
    });
  }

  test("serves the packages' asset and compiled script", async ({ request }) => {
    for (const [path, type] of [["/assets/pd-fixture-ds/dot.svg", "image/svg+xml"], ["/_pd/scripts/chip.js", "javascript"]]) {
      const res = await request.get(path, { headers: NO_CACHE });
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"], path).toContain(type);
    }
  });

  test("renders the skin's layout and the design system's card, its helper, styles and script", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1.sk-title")).toHaveText("PACKAGE BENCH");
    const card = page.frameLocator(`figure.doc-example iframe[src="/preview/molecules/card"]`);
    await expect(card.locator(".ds-chip")).toHaveText("DS:In a card");
    await expect(card.locator(".ds-card")).toHaveCSS("padding-top", "16px");
    await expect(card.locator(".ds-chip")).toHaveAttribute("data-ready", "true");
    await expect(page.locator("script[data-pd-live]")).toHaveCount(0);
  });
});
