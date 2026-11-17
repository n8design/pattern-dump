// A template pattern as a layout: `"x-pd-layout": "case-study"` in its schema makes it the layout a page names with
// `layout: case-study` (layout-index.ts in the dev-server); the page's markdown goes into its x-pd-content slot. Read
// off the rendered page, and off the workbench, where the template lists the pages that use it. The spec writes the
// template and a page into the bench and removes them after each test.
import { expect, test } from "./fixtures.js";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { save } from "../../test-support/save.js";
import { WORKBENCH } from "./helpers.js";

const template = fileURLToPath(new URL("../src/patterns/templates/", import.meta.url));
const page = fileURLToPath(new URL("../pages/zz-case.md", import.meta.url));

/** The server has handled every change made so far (fixtures.ts settles before each test, which is before this file's
 *  beforeEach writes its fixture): without this a test can ask while the watcher is still reading the new files. */
async function settled(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const res = await request.post("/_pd/__test/settle");
  if (res.status() !== 204) throw new Error(`settle answered ${res.status()}: ${await res.text()}`);
}

test.beforeEach(async ({ request }) => {
  await save(`${template}case-study/case-study.hbs`, [
    "{{#> partials-base }}",
    `<article class="case-study"><h1>{{title}}</h1><p class="case-client">{{client}}</p><div class="case-content">{{{content}}}</div></article>`,
    "{{/partials-base}}", "",
  ].join("\n"));
  await save(`${template}case-study/case-study.schema.json`, JSON.stringify({
    "x-pd-layout": "case-study", "x-pd-content": "content", required: ["title"],
    properties: {
      title: { type: "string" }, description: { type: "string" }, client: { type: "string" },
      content: { type: "string", contentMediaType: "text/markdown" },
    },
  }, null, 2));
  await save(`${template}case-study/case-study.json`, JSON.stringify({ title: "A case", client: "A client", content: "<p>Sample</p>" }));
  await save(page, "---\nlayout: case-study\ntitle: A case study\nclient: example.com\norder: 9\n---\n\nThe **work**, written in markdown.\n");
  await settled(request);
});
test.afterEach(async () => {
  await rm(page, { force: true });
  await rm(template, { recursive: true, force: true });
});

test.describe("a template pattern as a layout", () => {
  test("a page with layout: case-study renders through the template, its markdown in the content slot", async ({ page: p }) => {
    await p.goto("/zz-case/");
    await expect(p.locator("article.case-study h1")).toHaveText("A case study");
    await expect(p.locator(".case-client")).toHaveText("example.com");
    await expect(p.locator(".case-content strong")).toHaveText("work");
    // The skin's frame (partials/base) still wraps it: the site's nav is on the page.
    await expect(p.locator(".site-nav")).toBeVisible();
  });

  test("in the workbench, the template lists the page that uses it", async ({ page: p }) => {
    const detail = await (await p.request.get(`${WORKBENCH}/api/component/templates/case-study`)).json() as {
      relationships: { pages?: { route: string; path?: string; source: string }[] }; diagnostics: { kind: string }[];
    };
    expect(detail.relationships.pages).toEqual([{ route: "/zz-case/", path: "zz-case.md", source: "own" }]);
    expect(detail.diagnostics.filter(d => d.kind === "SCHEMA_INVALID")).toEqual([]);
  });
});
