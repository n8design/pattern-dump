// Folder defaults: a folder's index.md sets frontmatter for the pages under it in `childDefaults:` (folder-defaults.ts
// in the dev-server). Read off the rendered page: the layout and a declared key it took from the folder, its own value
// winning, a query option from the folder; and an edit to the index.md reaching a page that is already open. The spec
// writes a folder into the bench's pages and removes it after each test.
import { expect, test } from "./fixtures.js";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { save } from "../../test-support/save.js";

const folder = fileURLToPath(new URL("../pages/zz-defaults/", import.meta.url));
const index = (lede: string) => [
  "---", "title: Defaults", "order: 9",
  "childDefaults:", "  layout: article", `  lede: ${lede}`, "  related:", "    limit: 1",
  "---", "", "A folder whose pages take its defaults.", "",
].join("\n");

/** The server has handled every change made so far (fixtures.ts settles before each test, which is before this file's
 *  beforeEach writes its fixture): without this a test can ask while the watcher is still reading the new files. */
async function settled(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const res = await request.post("/_pd/__test/settle");
  if (res.status() !== 204) throw new Error(`settle answered ${res.status()}: ${await res.text()}`);
}

test.beforeEach(async ({ request }) => {
  await save(`${folder}index.md`, index("From the folder"));
  await save(`${folder}a.md`, "---\ntitle: Page A\n---\n\nIt names no layout and no lede.\n");
  await save(`${folder}b.md`, "---\ntitle: Page B\nlede: Its own\n---\n\nIt has a lede of its own.\n");
  await settled(request);
});
test.afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

test.describe("folder defaults", () => {
  test("a page takes its folder's layout and values; its own value wins", async ({ page }) => {
    await page.goto("/zz-defaults/a/");
    await expect(page.locator("article.article h1")).toHaveText("Page A");
    await expect(page.locator(".article-lede")).toHaveText("From the folder");
    await page.goto("/zz-defaults/b/");
    await expect(page.locator(".article-lede")).toHaveText("Its own");
    // related: limit 1 from the folder; the layout's query lists the folder's pages.
    await expect(page.locator("section.related li")).toHaveCount(1);
  });

  test("/api/pages names where each page's defaults came from", async ({ page }) => {
    const { pages } = await (await page.request.get("/api/pages")).json() as { pages: { route: string; layout: string; layoutFrom?: string; defaultsFrom?: Record<string, string> }[] };
    expect(pages.find(p => p.route === "/zz-defaults/a/")).toMatchObject({
      layout: "article", layoutFrom: "zz-defaults/index.md",
      defaultsFrom: { lede: "zz-defaults/index.md", related: "zz-defaults/index.md", "related.limit": "zz-defaults/index.md" },
    });
    expect(pages.find(p => p.route === "/zz-defaults/b/")?.defaultsFrom).toEqual({ related: "zz-defaults/index.md", "related.limit": "zz-defaults/index.md" });
  });

  test("an edit to the folder's index.md reaches a page under it that is already open", async ({ page }) => {
    await page.goto("/zz-defaults/a/");
    await expect(page.locator(".article-lede")).toHaveText("From the folder");
    await save(`${folder}index.md`, index("Changed in the folder"));
    await expect(page.locator(".article-lede")).toHaveText("Changed in the folder", { timeout: 10_000 });
  });
});
