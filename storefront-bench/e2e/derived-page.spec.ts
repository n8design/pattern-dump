// `page`, what the storefront derives for a page: a layout's sample data never reaches a real page through it.
// A site page renders without sample data, so sample keys under `page` (`page.foo`, `page.prev.extra`) are no
// problem and show nowhere on the page. The layout and a page using it are written into the bench at test time and
// removed after.
import { expect, test } from "./fixtures.js";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { saveInTwoSteps } from "../../test-support/save.js";
import { DEV, WORKBENCH } from "./helpers.js";

const bench = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const ADDED = ["src/patterns/layouts/zz-leak", "pages/zz-leak.md"];
const put = async (rel: string, text: string) => {
  await mkdir(dirname(bench(rel)), { recursive: true });
  await saveInTwoSteps(bench(rel), text);
};

// A safety net: the test itself removes what it added and waits until the server has seen it gone, so the
// reload that removal sends to every page lands before the next test opens one.
test.afterEach(async () => {
  for (const rel of ADDED) await rm(bench(rel), { recursive: true, force: true });
});

test("a layout's sample page data is never shown on a page, and is no problem", async ({ page }) => {
  await put("src/patterns/layouts/zz-leak/zz-leak.hbs",
    `{{#> partials-base }}\n<article class="zz-leak"><h1>{{title}}</h1>{{{body}}}`
    + `<p class="zz-leak-out">{{page.foo}} {{page.prev.extra}}</p></article>\n{{/partials-base}}\n`);
  await put("src/patterns/layouts/zz-leak/zz-leak.schema.json", JSON.stringify({
    type: "object", required: ["title"],
    properties: { title: { type: "string" }, page: { type: "object", properties: { prev: { type: "object" } } } },
  }));
  await put("src/patterns/layouts/zz-leak/zz-leak.json",
    JSON.stringify({ title: "Sample", page: { foo: "LEAKED-SAMPLE", prev: { title: "Before", extra: "LEAKED-NESTED" } } }));
  await put("pages/zz-leak.md", "---\nlayout: zz-leak\ntitle: Leak\norder: 9\n---\n\nA page on the leaking layout.\n");

  // Until the watcher has read every new file, the page is missing.
  await expect(async () => {
    await page.goto("/zz-leak/");
    await expect(page.locator("article.zz-leak h1")).toHaveText("Leak", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator("ul.pd-problems li")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("LEAKED");
  await expect(page.locator(".zz-leak-out")).toHaveCount(1);

  for (const rel of ADDED) await rm(bench(rel), { recursive: true, force: true });
  await expect.poll(async () => [
    (await page.request.get(`${DEV}/zz-leak/`)).status(),
    (await page.request.get(`${WORKBENCH}/api/component/layouts/zz-leak`)).status(),
  ], { timeout: 15_000 }).toEqual([404, 404]);
});
