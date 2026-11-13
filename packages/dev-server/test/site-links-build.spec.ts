// The link check in pd build and pd dev, on a project of its own:
//   - pd build refuses a site with a broken link, a missing anchor, a renamed component or a missing variant, and
//     writes nothing; a sound site builds, its report counts the links, and other hosts are notes;
//   - a workbench on the site's own host (/workbench/) is checked by its path;
//   - pd dev warns about a page's links to pages that don't exist and its own missing anchors, once each, and
//     serves the page.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;
const schema = JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } });

/** A project: a layout, a component with a variant, and `pages`. */
async function project(pages: Record<string, string>): Promise<string> {
  const root = join(tmp, `site-${n++}`);
  for (const [rel, body] of Object.entries({
    "src/patterns/layouts/page/page.hbs": `<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>Footer</p></footer>\n`,
    "src/patterns/layouts/page/page.schema.json": schema,
    "src/patterns/components/callout/callout.hbs": `<aside>Note</aside>\n`,
    "src/patterns/components/callout/callout~warning.hbs": `<aside>Careful</aside>\n`,
    ...Object.fromEntries(Object.entries(pages).map(([k, v]) => [`pages/${k}`, v])),
  })) await save(join(root, rel), body);
  return root;
}
const config = (workbenchUrl: string) => validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl, url: "https://site.test/" },
  ...(workbenchUrl.startsWith("/") ? { build: { basePath: workbenchUrl } } : {}),
}), "test");
const md = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n${body}\n`;

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-site-links-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("the link check in pd build", () => {
  it("refuses a site with broken links, and writes nothing", async () => {
    const root = await project({
      "index.md": md("Home", [
        "[A typo](/guids/)", "[A missing anchor](/about/#nowhere)", "[Here](#gone)",
        "[A renamed component](https://wb.test/components/calout)", "[A missing variant](https://wb.test/components/callout#danger)",
      ].join("\n\n")),
      "about.md": md("About", "## Team"),
    });
    const out = join(root, ".out", "wb");
    await expect(buildStaticSite(config("https://wb.test/"), root, { outDir: out, pdVersion: "0.0.0-test" })).rejects.toThrow([
      "pd build: the storefront has broken links, so nothing was written:",
      `  - /: <a href="/guids/">: no page or file is built at /guids/`,
      `  - /: <a href="/about/#nowhere">: /about/ has no element with id "nowhere"`,
      `  - /: <a href="#gone">: / has no element with id "gone"`,
      `  - /: <a href="https://wb.test/components/calout">: the workbench has no components/calout`,
      `  - /: <a href="https://wb.test/components/callout#danger">: components/callout has no variant "danger" in the workbench`,
    ].join("\n"));
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(root, "site"))).toBe(false);
  }, 60_000);

  it("builds a sound site: the report counts the links, and other hosts are notes", async () => {
    const root = await project({
      "index.md": md("Home", "[About](/about/#team) [Old](/old/) [Callout](https://wb.test/components/callout#warning) [Elsewhere](https://example.com/x)"),
      "about.md": `---\ntitle: About\nredirectFrom: [/old/]\n---\n\n## Team\n\n[Home](https://site.test/)\n`,
    });
    const report = await buildStaticSite(config("https://wb.test/"), root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test" });
    expect(report.links).toMatchObject({ pages: 3, external: 1 });
    expect(report.notes).toContain(`an external link, not checked: https://example.com/x (on /)`);
  }, 60_000);

  it("checks a workbench on the site's own host by its path", async () => {
    const root = await project({ "index.md": md("Home", "[Callout](/workbench/components/callout) [Gone](/workbench/components/nope)") });
    await expect(buildStaticSite(config("/workbench/"), root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test" }))
      .rejects.toThrow(`/: <a href="/workbench/components/nope">: the workbench has no components/nope`);
  }, 60_000);
});

describe("the link check in pd dev", () => {
  it("warns about links to pages that don't exist and missing anchors on the page, once each; the page is served", async () => {
    const root = await project({ "index.md": md("Home", "[A typo](/guids/) [Here](#gone) [Fine](/about/) [A file](/assets/x.png)"), "about.md": md("About", "Hi") });
    const log = vi.spyOn(console, "log");
    const server = await startDevServer(config("https://wb.test/"), root, { port: 0, wsPort: 0 });
    try {
      const host = config("https://wb.test/").storefront!.host ?? PD_HOSTS.storefront;
      for (let i = 0; i < 2; i++) {
        const status = await new Promise<number>((resolve, reject) => {
          const req = request({ host: "127.0.0.1", port: server.port, path: "/", headers: { host: `${host}:${server.port}` } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
          req.on("error", reject);
          req.end();
        });
        expect(status).toBe(200);
      }
      const said = log.mock.calls.map(c => String(c[0])).filter(s => s.includes("warning: index.md: <a"));
      expect(said).toEqual([
        `[storefront] warning: index.md: <a href="/guids/">: no page or file is built at /guids/`,
        `[storefront] warning: index.md: <a href="#gone">: / has no element with id "gone"`,
      ]);
    } finally {
      await server.close();
      log.mockRestore();
    }
  }, 60_000);
});
