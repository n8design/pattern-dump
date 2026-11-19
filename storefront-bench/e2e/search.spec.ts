// Search in the built site (search.ts, the starter's components/search): a copy of the bench, with the starter's search
// component on a search page and a draft, built with Pagefind and --browser, then searched in Chromium from its files.
// A word on one page finds that page; the section filter narrows the results; a word a listing shows in a teaser finds
// the page, not the listing; a draft's words find nothing; under a path, results link under it. Pagefind and
// Playwright here are the repository's, as a project's own would be.
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig, type SiteConfig } from "@pattern-dump/config";
import { buildStaticSite, loadProjectPagefind } from "@pattern-dump/dev-server";
import benchConfig from "../pattern-dump.config.js";
import { save } from "../../test-support/save.js";

test.setTimeout(180_000);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const starter = join(repo, "packages", "cli", "templates", "storefront");
const loadPlaywright = async () => ({ chromium });
const loadPagefind = () => loadProjectPagefind(repo);

let tmp = "";
test.beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-search-")); });
test.afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

/** The bench as committed, with the starter's search component and its script, a search page and a draft. */
async function benchWithSearch(name: string): Promise<string> {
  const root = join(tmp, name);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  await cp(join(starter, "src", "patterns", "components", "search"), join(root, "src", "patterns", "components", "search"), { recursive: true });
  await cp(join(starter, "src", "scripts", "site-search.ts"), join(root, "src", "scripts", "site-search.ts"));
  await save(join(root, "pages", "search.md"), "---\ntitle: Search\norder: 9\n---\n\n<pd-components-search></pd-components-search>\n");
  await save(join(root, "pages", "articles", "zz-draft.md"), "---\ntitle: Not yet\ndate: 2026-11-01\ndraft: true\n---\n\nA quokka, written ahead.\n");
  return root;
}

const config = (over: Partial<SiteConfig> = {}): PatternDumpConfig =>
  validateConfig({ ...benchConfig, site: { ...benchConfig.site!, ...over } }, "test");

/** A context that serves the built site's files at http://site.localhost/. */
async function served(context: BrowserContext, site: string, base = "/"): Promise<void> {
  await context.route("http://site.localhost/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith(base)) { await route.fulfill({ status: 404, body: "" }); return; }
    const rel = path.slice(base.length);
    const file = join(site, rel === "" || rel.endsWith("/") ? `${rel}index.html` : rel);
    await (existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: "" }));
  });
}

test.describe("search on the built bench", () => {
  let site = "";
  test.beforeAll(async () => {
    const root = await benchWithSearch("bench");
    const report = await buildStaticSite(config(), root, {
      outDir: join(root, ".out", "workbench"), pdVersion: "0.0.0-test", browser: true, loadPlaywright, loadPagefind,
    });
    // Every page of the site but the 404 page and the tag and category pages; never the draft.
    expect(report.search).toMatchObject({ pages: 8 });
    expect(report.drafts).toEqual(["articles/zz-draft.md"]);
    site = join(root, ".out", "site");
    // Only Pagefind's search files: its own UIs are not written.
    const files = await readdir(join(site, "_pd", "search"));
    expect(files).toContain("pagefind.js");
    expect(files.filter(f => f.startsWith("pagefind-ui"))).toEqual([]);
  });

  const results = (context: BrowserContext) => async (query: string) => {
    const page = await context.newPage();
    await page.goto(`http://site.localhost/search/?${query}`);
    const status = page.getByRole("status");
    await expect(status).toHaveText(/result/);
    const titles = await page.locator(".search-result-title a").allTextContents();
    return { page, status: await status.textContent(), titles };
  };

  test("a word on one page finds that page, with its section and the passage", async ({ browser }) => {
    const context = await browser.newContext();
    await served(context, site);
    const { page, status, titles } = await results(context)("q=photograph");
    expect(titles).toEqual(["A harbour of cable cars"]);
    expect(status).toBe(`1 result for "photograph".`);
    const result = page.locator(".search-result").first();
    await expect(result.locator(".search-result-section")).toHaveText("Articles");
    await expect(result.locator("mark")).toHaveText("photograph");
    await expect(result.locator("a")).toHaveAttribute("href", "/articles/harbour/");
    await context.close();
  });

  test("the section filter narrows the results", async ({ browser }) => {
    const context = await browser.newContext();
    await served(context, site);
    const all = await results(context)("q=skin");
    expect(all.titles.length).toBeGreaterThan(1);
    expect(all.titles).toContain("Plain on purpose");
    // Chosen in the form's section list, which the script adds once the index is loaded.
    await all.page.getByLabel("Section").selectOption("Articles");
    await expect(all.page.getByRole("status")).toHaveText(`1 result for "skin".`);
    expect(await all.page.locator(".search-result-title a").allTextContents()).toEqual(["Plain on purpose"]);
    expect(new URL(all.page.url()).searchParams.get("section")).toBe("Articles");
    await context.close();
  });

  test("a word a listing shows in its teaser finds the page, not the listing; a draft's words find nothing", async ({ browser }) => {
    const context = await browser.newContext();
    await served(context, site);
    // "markup" is in the harbour's first paragraph, its teaser, which the articles page lists.
    expect((await results(context)("q=markup")).titles).toEqual(["A harbour of cable cars"]);
    const draft = await results(context)("q=quokka");
    expect(draft.status).toBe(`No results for "quokka".`);
    expect(draft.titles).toEqual([]);
    await context.close();
  });

  test("typed into the field: results as you type, announced, and the words kept in the address", async ({ browser }) => {
    const context = await browser.newContext();
    await served(context, site);
    const page = await context.newPage();
    await page.goto("http://site.localhost/search/");
    await page.getByLabel("Search this site").fill("photograph");
    await expect(page.getByRole("status")).toHaveText(`1 result for "photograph".`);
    await expect(page.locator(".search-result-title a")).toHaveText(["A harbour of cable cars"]);
    expect(new URL(page.url()).searchParams.get("q")).toBe("photograph");
    await context.close();
  });
});

test("under a path: the index is under it, and results link under it", async ({ browser }) => {
  const root = await benchWithSearch("bench-path");
  await buildStaticSite(config({ url: "https://bench.example.test/sub/" }), root, {
    outDir: join(root, ".out", "workbench"), pdVersion: "0.0.0-test", loadPagefind,
  });
  const context = await browser.newContext();
  await served(context, join(root, ".out", "site"), "/sub/");
  const page = await context.newPage();
  await page.goto("http://site.localhost/sub/search/?q=photograph");
  await expect(page.getByRole("status")).toHaveText(`1 result for "photograph".`);
  await expect(page.locator(".search-result-title a")).toHaveAttribute("href", "/sub/articles/harbour/");
  await context.close();
});

test("without Pagefind the component says search works on the built site", async ({ browser }) => {
  const root = await benchWithSearch("bench-none");
  const report = await buildStaticSite(config(), root, {
    outDir: join(root, ".out", "workbench"), pdVersion: "0.0.0-test", loadPagefind: async () => undefined,
  });
  expect(report.search).toBeUndefined();
  expect(existsSync(join(root, ".out", "site", "_pd", "search"))).toBe(false);
  const context = await browser.newContext();
  await served(context, join(root, ".out", "site"));
  const page = await context.newPage();
  await page.goto("http://site.localhost/search/?q=photograph");
  await expect(page.getByRole("status")).toHaveText("Search works on the built site: this one has no search index.");
  await context.close();
});
