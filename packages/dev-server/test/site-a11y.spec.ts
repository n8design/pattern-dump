// The accessibility gate of pd build (step 6b) and its pd dev side:
//   - checkPageBasics: exactly one main landmark and one <h1>, read as elements, never as text;
//   - pd build refuses a site with a critical or serious WCAG finding, or a page without one main and one <h1>, and
//     writes nothing; a best-practice or moderate finding is a warning in the report, grouped by rule;
//   - pd dev warns about the main landmark and the <h1>, and serves the page.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer } from "@pattern-dump/dev-server";
import { checkPageBasics } from "../src/storefront/page-basics.js";
import { save } from "../../../test-support/save.js";

describe("checkPageBasics", () => {
  it("passes one <main> (or role=main) and one <h1>", () => {
    expect(checkPageBasics(`<main><h1>T</h1></main>`)).toEqual([]);
    expect(checkPageBasics(`<div role="main"><h1>T</h1></div>`)).toEqual([]);
  });
  it("names a missing or doubled main landmark and <h1>", () => {
    expect(checkPageBasics(`<div><h2>T</h2></div>`)).toEqual([
      "the page has no <main>: the page's own content goes in one, so assistive technology can go straight to it",
      "the page has no <h1>: one heading names the page",
    ]);
    expect(checkPageBasics(`<main><h1>A</h1></main><main><h1>B</h1></main>`)).toEqual([
      `the page has 2 main landmarks (<main> or role="main"): it has exactly one, holding the page's own content`,
      "the page has 2 <h1> headings: one names the page, the others are <h2> or lower",
    ]);
  });
  it("counts elements, never text: a code example's <h1> is not a heading", () => {
    expect(checkPageBasics(`<main><h1>T</h1><pre><code>&lt;h1&gt;x&lt;/h1&gt;</code></pre><script>"<h1>"</script></main>`)).toEqual([]);
  });
});

let tmp = "";
let n = 0;
const schema = JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } });
async function project(layout: string, body = "Text."): Promise<string> {
  const root = join(tmp, `site-${n++}`);
  for (const [rel, text] of Object.entries({
    "src/patterns/layouts/page/page.hbs": layout,
    "src/patterns/layouts/page/page.schema.json": schema,
    "pages/index.md": `---\ntitle: Home\n---\n\n${body}\n`,
  })) await save(join(root, rel), text);
  return root;
}
const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/" },
}), "test");
const SOUND = `<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>Footer</p></footer>\n`;

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-site-a11y-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("the accessibility gate in pd build", () => {
  it("builds a sound site, with no warnings", async () => {
    const root = await project(SOUND);
    const report = await buildStaticSite(config, root, { outDir: join(root, ".out"), pdVersion: "0.0.0-test" });
    expect(report.accessibility).toEqual({ pages: 2, warnings: [] });
  }, 60_000);

  it("refuses a serious WCAG finding and a page without one main and one <h1>, and writes nothing", async () => {
    const root = await project(`<header><p>Site</p><button></button></header><div>{{{body}}}</div><footer><p>F</p></footer>\n`);
    const out = join(root, ".out");
    const build = buildStaticSite(config, root, { outDir: out, pdVersion: "0.0.0-test" });
    await expect(build).rejects.toThrow("pd build: the storefront has accessibility problems, so nothing was written:");
    const message = await build.catch((e: Error) => e.message);
    expect(message).toContain("  - /: the page has no <main>:");
    expect(message).toContain("  - /: the page has no <h1>:");
    expect(message).toMatch(/ {2}- \/: button-name \(critical\): Buttons must have discernible text, on button \(https:\/\/dequeuniversity\.com\/rules\/axe\/[\d.]+\/button-name/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(root, "site"))).toBe(false);
  }, 60_000);

  it("lists a best-practice finding as a warning, grouped by rule with its pages, and builds", async () => {
    const root = await project(SOUND, "## Second\n\n#### Too deep");
    const report = await buildStaticSite(config, root, { outDir: join(root, ".out"), pdVersion: "0.0.0-test" });
    expect(report.accessibility?.warnings).toEqual([
      expect.stringMatching(/^heading-order \(moderate\): Heading levels should only increase by one, 1 element on \/ \(https:\/\/dequeuniversity\.com\//),
    ]);
  }, 60_000);
});

describe("the page basics in pd dev", () => {
  it("are warnings, said once; the page is served", async () => {
    const root = await project(`<div><h2>{{title}}</h2>{{{body}}}</div>\n`);
    const log = vi.spyOn(console, "log");
    const server = await startDevServer(config, root, { port: 0, wsPort: 0 });
    try {
      const host = config.storefront!.host ?? PD_HOSTS.storefront;
      for (let i = 0; i < 2; i++) {
        const status = await new Promise<number>((resolve, reject) => {
          const req = request({ host: "127.0.0.1", port: server.port, path: "/", headers: { host: `${host}:${server.port}` } },
            res => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
          req.on("error", reject);
          req.end();
        });
        expect(status).toBe(200);
      }
      expect(log.mock.calls.map(c => String(c[0])).filter(s => s.includes("warning: index.md: the page"))).toEqual([
        "[storefront] warning: index.md: the page has no <main>: the page's own content goes in one, so assistive technology can go straight to it",
        "[storefront] warning: index.md: the page has no <h1>: one heading names the page",
      ]);
    } finally {
      await server.close();
      log.mockRestore();
    }
  }, 60_000);
});
