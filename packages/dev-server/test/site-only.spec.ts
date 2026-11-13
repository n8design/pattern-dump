// A site with no patterns or styles of its own: its config names no sourceDir, patternsDir or styles (they default,
// and the folders don't exist), and its skin comes from a pattern package. pd dev serves its pages with nothing to
// warn about, and pd build writes the whole site.
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

let root = "";
const config = validateConfig(defineConfig({
  outDir: "./.out/workbench",
  packages: ["@acme/skin"],
  storefront: { pagesDir: "./pages", outDir: "./.out/site", workbenchUrl: "https://wb.test/" },
}), "test");
const SKIN = "node_modules/@acme/skin";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-site-only-"));
  for (const [rel, text] of Object.entries({
    [`${SKIN}/package.json`]: JSON.stringify({ name: "@acme/skin", version: "1.0.0", patternDump: { patterns: "patterns", styles: { dir: "styles" } } }),
    [`${SKIN}/patterns/layouts/page/page.hbs`]: `<header><p>Acme</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>Footer</p></footer>\n`,
    [`${SKIN}/patterns/layouts/page/page.schema.json`]: JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    [`${SKIN}/styles/layouts/page.scss`]: ".page { margin: 0; }\n",
    "pages/index.md": "---\ntitle: Home\n---\n\nWelcome.\n",
  })) await save(join(root, rel), text);
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("a site with no patterns or styles of its own", () => {
  it("has a config with the source folders filled in, none of which exists", () => {
    expect(config).toMatchObject({ sourceDir: "./src", patternsDir: "./src/patterns", styles: { dir: "./src/styles" } });
    expect(existsSync(join(root, "src"))).toBe(false);
  });

  it("pd dev serves its pages, dressed by the package, and warns about nothing", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const server = await startDevServer(config, root, { port: 0, wsPort: 0 });
    try {
      const host = config.storefront!.host ?? PD_HOSTS.storefront;
      const page = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: server.port, path: "/", headers: { host: `${host}:${server.port}` } }, res => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.end();
      });
      expect(page.status).toBe(200);
      expect(page.body).toContain("<main><h1>Home</h1>");
      expect(page.body).toMatch(/href="\/_pd\/components\/layouts\/page\.css\?v=[0-9a-f]{10}"/);
      const said = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
      expect(said.filter(s => /warn|problem|error|not found|missing/i.test(s))).toEqual([]);
    } finally {
      await server.close();
      log.mockRestore(); warn.mockRestore(); error.mockRestore();
    }
  }, 60_000);

  it("pd build writes the whole site from the package", async () => {
    const report = await buildStaticSite(config, root, { outDir: join(root, ".out", "workbench"), pdVersion: "0.0.0-test" });
    expect(report.storefront).toMatchObject({ pages: 1 });
    expect(existsSync(join(root, ".out", "site", "index.html"))).toBe(true);
    expect(existsSync(join(root, ".out", "site", "_pd", "components", "layouts", "page.css"))).toBe(true);
  }, 60_000);
});
