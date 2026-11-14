// A site's own head additions (storefront.head, a Handlebars file of the site's): rendered with `site` into every
// page's head, after the skin's partials/head and before the stylesheets, in pd dev and pd build. Checked as the skin's
// is: an element Pattern Dump writes itself, or one that doesn't belong in a head, is a problem on every page; so is a
// file that isn't there.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;
const servers: DevServer[] = [];
const HEAD = `<meta name="google-site-verification" content="abc123">\n<script defer src="https://analytics.example.test/script.js" data-key="{{site.analyticsKey}}"></script>\n`;

async function project(head: string | null): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries({
    "src/patterns/partials/head/head.hbs": `<meta name="theme-color" content="#123456">\n`,
    "src/patterns/partials/base/base.hbs": `{{> @partial-block }}\n`,
    "src/patterns/partials/base/base.schema.json": JSON.stringify({ type: "object", properties: {
      site: { type: "object", properties: { analyticsKey: { type: "string" } } } } }),
    "src/patterns/layouts/page/page.hbs": `{{#> partials-base}}<main><h1>{{title}}</h1>{{{body}}}</main>{{/partials-base}}\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "src/styles/layouts/page.scss": "main {\n  margin: 0;\n}\n",
    "pages/index.md": "---\ntitle: Home\n---\n\nHi.\n",
    "pages/about.md": "---\ntitle: About\n---\n\nMore.\n",
    ...(head !== null ? { "head.hbs": head } : {}),
  })) await save(join(root, rel), text);
  return root;
}
const config = (over: Record<string, unknown> = {}) => validateConfig(defineConfig({
  outDir: "./.out/wb",
  storefront: { pagesDir: "./pages", outDir: "./.out/site", workbenchUrl: "https://wb.test/", head: "./head.hbs",
    site: { analyticsKey: "site-42" }, ...over },
}), "test");

async function serve(root: string): Promise<DevServer> {
  const s = await startDevServer(config(), root, { port: 0, live: false });
  servers.push(s);
  return s;
}
function get(s: DevServer, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: s.port, path, headers: { host: `${PD_HOSTS.storefront}:${s.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}
const headOf = (html: string) => html.slice(html.indexOf("<head>"), html.indexOf("</head>"));

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-site-head-")); });
afterAll(async () => {
  await Promise.all(servers.map(s => s.close()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("storefront.head", () => {
  it("goes into every page's head with the site's values, after the skin's head and before the stylesheets", async () => {
    const s = await serve(await project(HEAD));
    for (const page of ["/", "/about/"]) {
      const head = headOf((await get(s, page)).body);
      expect(head, page).toMatch(/<meta name="theme-color" content="#123456">\n<meta name="google-site-verification" content="abc123">\n<script defer src="https:\/\/analytics\.example\.test\/script\.js" data-key="site-42"><\/script>\n<link rel="stylesheet" /);
    }
  });

  it("is in the pages pd build writes", async () => {
    const root = await project(HEAD);
    await buildStaticSite(config(), root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test" });
    expect(await readFile(join(root, ".out", "site", "about", "index.html"), "utf8")).toContain(`<meta name="google-site-verification" content="abc123">`);
  }, 60_000);

  it("may not write what Pattern Dump writes, nor what doesn't belong in a head: a problem on every page", async () => {
    const s = await serve(await project(`<title>Mine</title>\n<meta name="description" content="x">\n<div>no</div>\n`));
    const page = await get(s, "/about/");
    expect(page.status).toBe(500);
    const text = page.body.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    for (const p of [
      `storefront.head (./head.hbs): <title> is written by Pattern Dump on every page; the site's head must not write it`,
      `storefront.head (./head.hbs): <meta name="description"> is written by Pattern Dump on every page; the site's head must not write it`,
      `storefront.head (./head.hbs): <div> does not belong in <head>: the site's head may hold only <meta>, <link>, <script>, <style> and <noscript>`,
    ]) expect(text).toContain(p);
  });

  it("names the file when it isn't there", async () => {
    const s = await serve(await project(null));
    const page = await get(s, "/");
    expect(page.status).toBe(500);
    expect(page.body).toContain("storefront.head (./head.hbs): there is no such file");
  });
});
