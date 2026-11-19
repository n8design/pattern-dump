// The page accessibility check spread over worker threads (@pattern-dump/a11y runPagesA11y): the findings of every
// page come back in the order of the pages, the same as checking them one by one in this thread, whatever order the
// workers finish in and however often a worker is replaced; and pd build reports the same with one worker or several.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCheckWorkers, MOST_CHECK_WORKERS, runPageA11y, runPagesA11y } from "@pattern-dump/a11y";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

/** A page that passes, one that warns (a heading that skips levels) and one with an error (a link with no text);
 *  `rows` makes it slow to check, so a slow page given first finishes after the quick ones behind it. */
const page = (kind: "sound" | "warns" | "error", rows = 0): string => `<!DOCTYPE html><html lang="en"><head><title>T</title></head>
<body><header><p>Site</p></header><main><h1>Page</h1>${kind === "warns" ? "<h4>Skipped</h4>" : ""}
${kind === "error" ? `<p><a href="/x/"></a></p>` : ""}${"<p>Row <span>of</span> text</p>".repeat(rows)}</main><footer><p>F</p></footer></body></html>`;

describe("runPagesA11y", () => {
  const pages = [page("warns", 3000), page("sound"), page("error"), page("warns"), page("sound", 1500), page("error"), page("warns")];

  it("gives each page's findings in the pages' order, as checking them one by one does", async () => {
    const oneByOne: unknown[] = [];
    for (const p of pages) oneByOne.push(await runPageA11y(p));
    expect(oneByOne.map(f => (f as Array<{ ruleId: string }>).map(x => x.ruleId))).toEqual([
      ["heading-order"], [], ["link-name"], ["heading-order"], [], ["link-name"], ["heading-order"],
    ]);
    expect(await runPagesA11y(pages, { workers: 1 })).toEqual(oneByOne);
    expect(await runPagesA11y(pages, { workers: 3 })).toEqual(oneByOne);
    // Every worker replaced after each page: the same again.
    expect(await runPagesA11y(pages, { workers: 3, pagesPerWorker: 1 })).toEqual(oneByOne);
  }, 120_000);

  it("checks no pages, and fewer pages than workers", async () => {
    expect(await runPagesA11y([], { workers: 4 })).toEqual([]);
    expect((await runPagesA11y([page("error")], { workers: 4 }))[0]!.map(f => f.ruleId)).toEqual(["link-name"]);
  }, 60_000);
});

describe("defaultCheckWorkers", () => {
  const GB = 1024 ** 3;
  it("is the cores less one, at most 8, within a quarter of the memory at 350 MB each, and at least 1", () => {
    expect(defaultCheckWorkers(16, 128 * GB)).toBe(MOST_CHECK_WORKERS);
    expect(defaultCheckWorkers(4, 16 * GB)).toBe(3);
    expect(defaultCheckWorkers(16, 4 * GB)).toBe(2);
    expect(defaultCheckWorkers(1, 128 * GB)).toBe(1);
    expect(defaultCheckWorkers(16, 1 * GB)).toBe(1);
  });
});

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-a11y-pool-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("pd build with several check workers", () => {
  const config = validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/" },
  }), "test");
  const files = (withError: boolean): Record<string, string> => {
    const f: Record<string, string> = {
      "src/patterns/layouts/page/page.hbs": `<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>\n`,
      "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
      "pages/index.md": "---\ntitle: Home\n---\n\nText.\n",
    };
    for (let i = 1; i <= 12; i++) {
      const skip = i % 3 === 0 ? "#### Skipped\n\n" : "";
      const empty = withError && (i === 4 || i === 10) ? "See [](/page-01/).\n\n" : "";
      // Page 4 is long, so it is checked last: a report in finishing order would name page 10 first.
      const long = i === 4 ? "More *text* here.\n\n".repeat(1500) : "";
      f[`pages/page-${String(i).padStart(2, "0")}.md`] = `---\ntitle: Page ${i}\n---\n\n${skip}${empty}${long}Text ${i}.\n`;
    }
    return f;
  };
  const project = async (name: string, withError: boolean): Promise<string> => {
    const root = join(tmp, name);
    for (const [rel, text] of Object.entries(files(withError))) await save(join(root, rel), text);
    return root;
  };
  const build = (root: string, checkWorkers: number) =>
    buildStaticSite(config, root, { outDir: join(root, ".out"), pdVersion: "0.0.0-test", checkWorkers });

  it("reports the same warnings, pages in the same order, with one worker and with three", async () => {
    const root = await project("warns", false);
    const one = await build(root, 1);
    const three = await build(root, 3);
    expect(one.accessibility?.warnings).toHaveLength(1);
    expect(one.accessibility?.warnings[0]).toContain("heading-order (moderate)");
    expect(one.accessibility?.warnings[0]).toContain("on /page-03/, /page-06/, /page-09/, /page-12/ ");
    expect(three.accessibility).toEqual(one.accessibility);
  }, 120_000);

  it("stops with the same errors, in the pages' order, with one worker and with three", async () => {
    const root = await project("errors", true);
    const message = async (workers: number) => build(root, workers).then(() => "", (e: Error) => e.message);
    const one = await message(1);
    expect(one).toMatch(/^pd build: the site has accessibility problems, so nothing was written:\n {2}- \/page-04\/: link-name .*\n {2}- \/page-10\/: link-name /);
    expect(await message(3)).toBe(one);
  }, 120_000);
});
