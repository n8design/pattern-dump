// A page's old routes (frontmatter redirectFrom) forward to it, in pd dev and on a static host alike: the
// page at each old route forwards at once, names the page as canonical, and is never indexed.
import { expect, test } from "./fixtures.js";
import { DEV, isDev, SITE_URL } from "./helpers.js";

for (const old of ["/setup/", "/start/"]) {
  test(`${old} forwards to /guides/setup/`, async ({ page, request }, info) => {
    const stub = await request.get(old);
    expect(stub.status()).toBe(200);
    const html = await stub.text();
    expect(html).toContain(`<meta name="robots" content="noindex">`);
    expect(html).toContain(`<link rel="canonical" href="${isDev(info) ? `${DEV}/` : SITE_URL}guides/setup/">`);
    await page.goto(old);
    await expect(page).toHaveURL(/\/guides\/setup\/$/);
    await expect(page.locator("h1")).toHaveText("Setup");
  });
}
