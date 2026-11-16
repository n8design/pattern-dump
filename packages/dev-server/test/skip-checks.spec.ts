// pd build checks everything unless told otherwise. skipChecks (or build.skipChecks in the config) leaves a named check
// out, for a quick local build, and the report lists what was left out; a name it doesn't know, and --browser with the
// accessibility check skipped, stop the build before anything is built.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-skip-checks-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

/** A site whose one page fails a WCAG rule (a link with no text), which stops a build that checks it. */
async function failingSite(): Promise<string> {
  const root = join(tmp, `site-${n++}`);
  for (const [rel, text] of Object.entries({
    "src/patterns/layouts/page/page.hbs": `<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "pages/index.md": "---\ntitle: Home\n---\n\nSee [](/) for more.\n",
  })) await save(join(root, rel), text);
  return root;
}
const config = (build?: PatternDumpConfig["build"]): PatternDumpConfig => validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/" },
  ...(build ? { build } : {}),
}), "test");
const opts = (root: string) => ({ outDir: join(root, ".out"), pdVersion: "0.0.0-test" });

describe("skipChecks", () => {
  it("checks accessibility by default: the failing page stops the build", async () => {
    const root = await failingSite();
    await expect(buildStaticSite(config(), root, opts(root))).rejects.toThrow("the storefront has accessibility problems");
  }, 60_000);

  it("leaves the accessibility check out when asked, and the report says so", async () => {
    const root = await failingSite();
    const report = await buildStaticSite(config(), root, { ...opts(root), skipChecks: ["a11y"] });
    expect(report.skippedChecks).toEqual(["a11y"]);
    expect(report.accessibility).toBeUndefined();
    expect(existsSync(join(root, "site", "index.html"))).toBe(true);
  }, 60_000);

  it("takes build.skipChecks from the config, and the option over it (an empty list checks everything)", async () => {
    const root = await failingSite();
    const fromConfig = await buildStaticSite(config({ skipChecks: ["a11y"] }), root, opts(root));
    expect(fromConfig.skippedChecks).toEqual(["a11y"]);
    await expect(buildStaticSite(config({ skipChecks: ["a11y"] }), root, { ...opts(root), skipChecks: [] }))
      .rejects.toThrow("the storefront has accessibility problems");
  }, 60_000);

  it("names a check it can't skip, and refuses --browser with the accessibility check skipped", async () => {
    const root = await failingSite();
    await expect(buildStaticSite(config(), root, { ...opts(root), skipChecks: ["links"] }))
      .rejects.toThrow(`pd build: "links" is not a check pd build can skip; it can skip "a11y"`);
    await expect(buildStaticSite(config(), root, { ...opts(root), skipChecks: ["a11y"], browser: true }))
      .rejects.toThrow("pd build: --browser checks the pages' accessibility in Chromium, so it can't be combined with skipping the accessibility check");
    expect(existsSync(join(root, ".out"))).toBe(false);
  }, 60_000);
});
