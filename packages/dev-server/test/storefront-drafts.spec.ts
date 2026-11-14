// Drafts: `draft: true` shows a page in pd dev, listed with draft: true, and leaves it out of pd build as if its file
// weren't there: out of the page list, the nav, every listing, the sitemap and the output, its old routes unwritten,
// and a link to it a broken link. A folder whose index.md is a draft takes its pages with it. The report names them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { readPages } from "../src/storefront/pages.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-drafts-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const md = (title: string, extra = "", body = `Text of ${title}.`) => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;
const schema = JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" }, page: { type: "object", properties: { children: {} } } } });

async function project(pages: Record<string, string>): Promise<string> {
  const root = join(tmp, `site-${n++}`);
  for (const [rel, body] of Object.entries({
    "src/patterns/layouts/page/page.hbs": `<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}<ul>{{#each page.children}}<li><a href="{{route}}">{{title}}</a></li>{{/each}}</ul></main><footer><p>F</p></footer>\n`,
    "src/patterns/layouts/page/page.schema.json": schema,
    ...Object.fromEntries(Object.entries(pages).map(([k, v]) => [`pages/${k}`, v])),
  })) await save(join(root, rel), body);
  return root;
}
const config = () => validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/", url: "https://site.test/" },
}), "test");

const site = {
  "index.md": md("Home"),
  "articles/index.md": md("Articles"),
  "articles/live.md": md("Live"),
  "articles/wip.md": md("Work in progress", "draft: true\nredirectFrom: [/wip/]\n"),
  "notes/index.md": md("Notes", "draft: true\n"),
  "notes/first.md": md("First note"),
};

describe("readPages and drafts", () => {
  it("shows drafts by default, each listed with draft: true; a page under a draft folder is not itself a draft", async () => {
    const model = await readPages(join(await project(site), "pages"));
    expect(model.pages.map(p => p.route)).toContain("/articles/wip/");
    expect(model.entries.get("/articles/wip/")?.draft).toBe(true);
    expect(model.entries.get("/notes/first/")?.draft).toBe(false);
    expect(model.drafts).toEqual(["articles/wip.md", "notes/index.md"]);
  });

  it("leaves them out, with every page under a draft folder, as if their files weren't there", async () => {
    const model = await readPages(join(await project(site), "pages"), { drafts: "leave-out" });
    expect(model.problems).toEqual([]);
    expect(model.pages.map(p => p.route).sort()).toEqual(["/", "/articles/", "/articles/live/"]);
    expect(JSON.stringify(model.nav)).not.toMatch(/wip|notes/);
    expect(model.folders.get("/articles/")?.children).toEqual(["/articles/live/"]);
    expect(model.folders.has("/notes/")).toBe(false);
    expect(model.drafts).toEqual(["articles/wip.md", "notes/first.md", "notes/index.md"]);
  });
});

describe("pd build and drafts", () => {
  it("writes no draft, lists none, writes none of its old routes, and names them in the report", async () => {
    const root = await project(site);
    const report = await buildStaticSite(config(), root, { outDir: join(root, "dist"), pdVersion: "0.0.0-test" });
    expect(report.drafts).toEqual(["articles/wip.md", "notes/first.md", "notes/index.md"]);
    expect(existsSync(join(root, "site", "articles", "live", "index.html"))).toBe(true);
    for (const gone of ["articles/wip", "wip", "notes", "notes/first"]) expect(existsSync(join(root, "site", gone)), gone).toBe(false);
    expect(await readFile(join(root, "site", "articles", "index.html"), "utf8")).not.toContain("/articles/wip/");
    expect(await readFile(join(root, "site", "sitemap.xml"), "utf8")).not.toMatch(/wip|notes/);
  }, 60_000);

  it("a link to a draft from a published page is a broken link", async () => {
    const root = await project({ ...site, "index.md": md("Home", "", "[Soon](/articles/wip/)") });
    await expect(buildStaticSite(config(), root, { outDir: join(root, "dist"), pdVersion: "0.0.0-test" }))
      .rejects.toThrow(`  - /: <a href="/articles/wip/">: no page or file is built at /articles/wip/`);
  }, 60_000);

  it("a site without drafts has no drafts in its report", async () => {
    const root = await project({ "index.md": md("Home") });
    const report = await buildStaticSite(config(), root, { outDir: join(root, "dist"), pdVersion: "0.0.0-test" });
    expect(Object.hasOwn(report, "drafts")).toBe(false);
  }, 60_000);
});
