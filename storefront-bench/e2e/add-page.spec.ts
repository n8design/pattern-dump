// Adding a markdown file adds a page and a nav entry, with no other change; removing it takes both away.
// The spec writes into the bench's pages and removes what it added after each test.
import { expect, test } from "@playwright/test";
import { rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const added = fileURLToPath(new URL("../pages/zz-added.md", import.meta.url));
test.afterEach(async () => { await rm(added, { force: true }); });

test.describe("adding a page", () => {
  test("a new markdown file is a new page and a new nav entry, and removing it takes both away", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".site-nav a")).toHaveText(["(01) Guides", "(02) About"]);

    await writeFile(added, "---\ntitle: Added\norder: 9\n---\n\nA page added while the site was open.\n");
    // The open page reloads (page-changed for every page) and its nav now has the new entry.
    await expect(page.locator(".site-nav a")).toHaveText(["(01) Guides", "(02) About", "(03) Added"], { timeout: 10_000 });
    await page.locator('.site-nav a[href="/zz-added/"]').click();
    await expect(page.locator("h1")).toHaveText("Added");
    await expect(page.locator(".page-body")).toContainText("A page added while the site was open.");

    await page.goto("/");
    await rm(added);
    await expect(page.locator(".site-nav a")).toHaveText(["(01) Guides", "(02) About"], { timeout: 10_000 });
    expect((await page.request.get("/zz-added/")).status()).toBe(404);
  });
});
