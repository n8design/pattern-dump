// pd dev reloads a storefront page when it changes: an edit shows on the open page; a frontmatter error
// replaces it with the problems (the live client stays, so the fix reloads it back). The spec writes into
// the bench's pages and restores them after each test.
import { expect, test } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { save } from "../../test-support/save.js";

const about = fileURLToPath(new URL("../pages/about.md", import.meta.url));
let original = "";

test.beforeEach(async () => { original = await readFile(about, "utf8"); });
test.afterEach(async () => { await save(about, original); });

test.describe("storefront pages reload in pd dev", () => {
  test("an edit to a page shows on the open page", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.locator("h1")).toHaveText("About");
    await save(about, `${original}\nAn edit made while the page was open.\n`);
    await expect(page.locator(".doc-body")).toContainText("An edit made while the page was open.", { timeout: 10_000 });
  });

  test("a title edit reaches another open page, whose nav shows it", async ({ page }) => {
    await page.goto("/guides/");
    const link = page.locator('.site-nav a[href="/about/"]');
    await expect(link).toHaveText("About");
    await save(about, original.replace("title: About", "title: About us"));
    await expect(link).toHaveText("About us", { timeout: 10_000 });
  });

  test("a frontmatter error replaces the page with its problems, and the fix brings it back", async ({ page }) => {
    await page.goto("/about/");
    await save(about, original.replace("title: About", "title: About\nbogus: 1"));
    await expect(page.locator(".pd-problems li")).toHaveText([`about.md:4: "bogus" is not declared by layout "doc"`], { timeout: 10_000 });
    expect(await page.locator("script[data-pd-live]").count()).toBe(1);
    await save(about, original);
    await expect(page.locator("h1")).toHaveText("About", { timeout: 10_000 });
  });
});
