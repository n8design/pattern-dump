// Authoring with new files: one running pd dev, one open page, never restarted or reloaded by hand.
// Each step adds files (or switches a page to one of them) and the open page must reload itself and
// show the change. The spec writes into the bench and removes what it added after the test.
import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const bench = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const ADDED = [
  "src/patterns/layouts/zz-plain", "src/styles/layouts/zz-plain.scss", "pages/zz-new.md",
  "src/assets/images/zz-dot.svg", "src/styles/site/zz-added.scss",
  "src/patterns/partials/zz-badge", "src/styles/partials/zz-badge.scss",
];
const about = bench("pages/about.md");
let original = "";

const put = async (rel: string, text: string) => {
  await mkdir(dirname(bench(rel)), { recursive: true });
  await writeFile(bench(rel), text);
};
/** A marker on the open document: gone once the page has reloaded. */
const mark = (page: Page) => page.evaluate(() => { (window as unknown as { stale: boolean }).stale = true; });
// While the page is mid-reload there is no document to ask, which counts as not reloaded yet.
const reloaded = (page: Page) => expect.poll(
  () => page.evaluate(() => !(window as unknown as { stale?: boolean }).stale).catch(() => false),
  { timeout: 10_000 },
).toBe(true);

test.beforeEach(async () => { original = await readFile(about, "utf8"); });
test.afterEach(async () => {
  await writeFile(about, original);
  for (const rel of ADDED) await rm(bench(rel), { recursive: true, force: true });
});

test("new layouts, stylesheets, assets, base-layer files and partials reach the open page without a restart", async ({ page }) => {
  await page.goto("/about/");
  await expect(page.locator("h1")).toHaveText("About");

  await test.step("a new layout, and a new page that uses it", async () => {
    await mark(page);
    await put("src/patterns/layouts/zz-plain/zz-plain.hbs",
      `{{#> partials-base }}\n<article class="zz-plain"><h1 class="zz-plain-title">{{title}}</h1><div class="page-body">{{{body}}}</div></article>\n{{/partials-base}}\n`);
    await put("src/patterns/layouts/zz-plain/zz-plain.schema.json",
      JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" }, description: { type: "string" } } }));
    await put("pages/zz-new.md", "---\nlayout: zz-plain\ntitle: New page\norder: 9\n---\n\nA page on a new layout.\n");
    await reloaded(page);
    await expect(page.locator(".site-nav-list > li > a")).toHaveText(["Storefront bench", "Guides", "About", "New page"]);
    await page.locator('.site-nav a[href="/zz-new/"]').click();
    await expect(page.locator("h1.zz-plain-title")).toHaveText("New page");
  });

  await test.step("a new stylesheet for it", async () => {
    await mark(page);
    await put("src/styles/layouts/zz-plain.scss", ".zz-plain-title {\n  color: rgb(1 2 3);\n}\n");
    await reloaded(page);
    await expect(page.locator("h1.zz-plain-title")).toHaveCSS("color", "rgb(1, 2, 3)");
  });

  await test.step("a new image, referenced from that stylesheet", async () => {
    await mark(page);
    await put("src/assets/images/zz-dot.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="red"/></svg>\n`);
    await put("src/styles/layouts/zz-plain.scss", `.zz-plain-title {\n  color: rgb(1 2 3);\n  background: url("/assets/images/zz-dot.svg");\n}\n`);
    await reloaded(page);
    await expect(page.locator("h1.zz-plain-title")).toHaveCSS("background-image", /\/assets\/images\/zz-dot\.svg/);
    const image = await page.request.get("/assets/images/zz-dot.svg");
    expect([image.status(), image.headers()["content-type"]]).toEqual([200, "image/svg+xml"]);
  });

  await test.step("a new file in the base layer", async () => {
    // Only storefront pages are open on this server so far: the workbench specs run later. Were the
    // workbench open, its own reload of the component on screen would reload this page too, and hide a
    // storefront page that is not told about base-layer changes.
    await mark(page);
    await put("src/styles/site/zz-added.scss", ".site-footer {\n  letter-spacing: 0.3em;\n}\n");
    await reloaded(page);
    await expect(page.locator(".site-footer")).not.toHaveCSS("letter-spacing", "normal");
  });

  await test.step("a new partial, its stylesheet saved before its template", async () => {
    await mark(page);
    await put("src/styles/partials/zz-badge.scss", ".zz-badge {\n  color: rgb(4 5 6);\n}\n");
    await reloaded(page);
    await mark(page);
    await put("src/patterns/partials/zz-badge/zz-badge.hbs", `<p class="zz-badge">New badge</p>\n`);
    await put("src/patterns/layouts/zz-plain/zz-plain.hbs",
      `{{#> partials-base }}\n<article class="zz-plain"><h1 class="zz-plain-title">{{title}}</h1>{{> partials-zz-badge }}<div class="page-body">{{{body}}}</div></article>\n{{/partials-base}}\n`);
    await reloaded(page);
    await expect(page.locator(".zz-badge")).toHaveCSS("color", "rgb(4, 5, 6)");
    // The partial's rules are its own stylesheet, linked from the page, and no longer in the base layer.
    await expect.poll(async () => {
      await page.reload();
      const links = await page.locator('link[rel="stylesheet"]').evaluateAll(ls => ls.map(l => l.getAttribute("href")));
      const base = await (await page.request.get("/_pd/base.css")).text();
      return [links.includes("/_pd/components/partials/zz-badge.css"), base.includes(".zz-badge")];
    }, { timeout: 10_000 }).toEqual([true, false]);
  });

  await test.step("an existing page switched to the new layout", async () => {
    await page.goto("/about/");
    await mark(page);
    await writeFile(about, original.replace("title: About", "layout: zz-plain\ntitle: About"));
    await reloaded(page);
    await expect(page.locator("h1")).toHaveClass("zz-plain-title");
    await expect(page.locator("h1")).toHaveCSS("color", "rgb(1, 2, 3)");
  });
});
