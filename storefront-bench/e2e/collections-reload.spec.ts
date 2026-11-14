// pd dev keeps an open listing current: an edit to what a listing shows of a page (its date, its description, its
// first paragraph when it has no description) reaches the open listing page and the home page's latest articles,
// without a manual reload. The state is the open page's; the edited page is never the one that is open.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.js";
import { isDev } from "./helpers.js";
import { save } from "../../test-support/save.js";

const file = (name: string) => fileURLToPath(new URL(`../pages/articles/${name}.md`, import.meta.url));
const originals = new Map<string, string>();

test.beforeEach(async () => {
  test.skip(!isDev(test.info()), "live reload is pd dev's");
  for (const name of ["harbour", "plain"]) originals.set(name, await readFile(file(name), "utf8"));
});
test.afterEach(async () => {
  for (const [name, text] of originals) await save(file(name), text);
  originals.clear();
});

test("a date edit reorders the open listing, and the home page's latest", async ({ page, browser }) => {
  await page.goto("/articles/");
  await expect(page.locator(".card-title a")).toHaveText(["A harbour of cable cars", "Plain on purpose"]);
  const home = await browser.newPage({ baseURL: test.info().project.use.baseURL });
  await home.goto("/");
  await expect(home.locator(".home-latest a")).toHaveText(["A harbour of cable cars", "Plain on purpose"]);
  await save(file("plain"), originals.get("plain")!.replace("date: 2026-10-02", "date: 2026-11-05"));
  await expect(page.locator(".card-title a")).toHaveText(["Plain on purpose", "A harbour of cable cars"], { timeout: 10_000 });
  await expect(page.locator(".card-date time").first()).toHaveText("2026-11-05");
  await expect(home.locator(".home-latest a")).toHaveText(["Plain on purpose", "A harbour of cable cars"], { timeout: 10_000 });
  await home.close();
});

test("a description edit shows on the open listing", async ({ page }) => {
  await page.goto("/articles/");
  await save(file("plain"), originals.get("plain")!.replace("description: Why the bench's skin is a wireframe.", "description: An edited description."));
  await expect(page.locator(".card-teaser").nth(1)).toHaveText("An edited description.", { timeout: 10_000 });
});

test("an edit to the first paragraph of a page without a description shows as its new teaser", async ({ page }) => {
  await page.goto("/articles/");
  await expect(page.locator(".card-teaser").first()).toContainText("This article has no description");
  await save(file("harbour"), originals.get("harbour")!.replace("This article has no description, so", "Edited while the listing was open:"));
  await expect(page.locator(".card-teaser").first()).toContainText("Edited while the listing was open:", { timeout: 10_000 });
  await expect(page.locator(".card-teaser").first()).not.toContainText("This article has no description");
});
