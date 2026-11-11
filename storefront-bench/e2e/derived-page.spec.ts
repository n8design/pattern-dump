// `page`, what the storefront derives for a page: a layout's sample data must never reach a real page
// through it. The renderer merges sample data beneath a page's values key by key, so sample keys under
// `page` (`page.foo`, `page.prev.extra`) would show on every page using the layout. The layout and a page
// using it are written into the bench at test time and removed after.
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

test("a layout's sample page data is a listed problem on the page, never shown on it", async ({ page }) => {
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

  const sample = (key: string) => `the sample data of layouts/zz-leak (zz-leak.json) sets "${key}", `
    + `which is not part of the page data Pattern Dump fills, so it would show on every page using layouts/zz-leak`;
  const problems = page.locator("ul.pd-problems li");
  // Until the watcher has read every new file, the page is missing or renders without the sample check.
  await expect(async () => {
    await page.goto("/zz-leak/");
    await expect(problems).toContainText([sample("page.foo"), sample("page.prev.extra")], { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator("h1")).toHaveText("The page /zz-leak/ cannot be built");
  await expect(page.locator("body")).not.toContainText("LEAKED");
  await expect(page.locator(".zz-leak-out")).toHaveCount(0);

  for (const rel of ADDED) await rm(bench(rel), { recursive: true, force: true });
  await expect.poll(async () => [
    (await page.request.get(`${DEV}/zz-leak/`)).status(),
    (await page.request.get(`${WORKBENCH}/api/component/layouts/zz-leak`)).status(),
  ], { timeout: 15_000 }).toEqual([404, 404]);
});

