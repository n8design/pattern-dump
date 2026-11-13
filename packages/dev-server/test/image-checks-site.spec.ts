// The image checks on assembled storefront pages (image-checks.ts, page.ts), on a served project:
//   - pd build (a headless server): an <img> without width and height, and a raster not served by the image route,
//     fail the page, the body's named by the page's file and the rest by the layout;
//   - pd dev: the same findings are warnings, printed once, and the page is served;
//   - an external image with a size passes, and is said in the notes (pd build's report) as one Pattern Dump
//     can't make variants of.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  storefront: { pagesDir: "./pages", outDir: "./site" },
});
const SITE = config.storefront!.host ?? PD_HOSTS.storefront;
const LOGO_SIZE = `layouts/page: <img src="/assets/images/logo.png"> has no width and height, so the page shifts when it loads: `
  + `give both, or place it with {{pd-image}}`;
const LOGO_RASTER = `layouts/page: <img src="/assets/images/logo.png"> is a raster image served as it is: place it with `
  + `{{pd-image}} in a template, or as a markdown image in a page, so it gets its WebP variants`;
const REMOTE_SIZE = `index.md: <img src="https://example.com/a.jpg"> has no width and height, so the page shifts when it loads: `
  + `give both, or place it with {{pd-image}}`;
const EXTERNAL = (where: string, src: string) =>
  `${where}: <img src="${src}"> is an external image: Pattern Dump can't make WebP variants of it, so it is served as it is`;

let root = "";
const notes: string[] = [];
let built: DevServer;
let dev: DevServer;
const log = vi.spyOn(console, "log");

function get(server: DevServer, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${SITE}:${server.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-image-checks-"));
  const schema = JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } });
  for (const [rel, body] of Object.entries({
    // A PNG header is all the asset route needs to serve it.
    "src/assets/images/logo.png": "png",
    "src/patterns/layouts/page/page.hbs": `<header><img src="/assets/images/logo.png" alt="Logo"></header><main>{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": schema,
    "src/patterns/layouts/framed/framed.hbs": `<header><img src="https://example.com/b.png" width="40" height="40" alt="Partner"></header><main>{{{body}}}</main>\n`,
    "src/patterns/layouts/framed/framed.schema.json": schema,
    "pages/index.md": `---\ntitle: Home\n---\n\n![A remote photo](https://example.com/a.jpg)\n`,
    "pages/external.md": `---\ntitle: External\nlayout: framed\n---\n\nText only.\n`,
  })) await save(join(root, rel), body);
  built = await startDevServer(config, root, { port: 0, live: false, onStorefrontNote: note => { notes.push(note); } });
  dev = await startDevServer(config, root, { port: 0, wsPort: 0 });
});
afterAll(async () => {
  await built?.close();
  await dev?.close();
  log.mockRestore();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("the image checks on a storefront page", () => {
  it("fail the page in pd build: the layout's raster without a size, and the page's remote image without one", async () => {
    const page = await get(built, "/");
    expect(page.status).toBe(500);
    const problems = [...page.body.matchAll(/<li>([^<]*)<\/li>/g)].map(m => m[1]!.replaceAll("&lt;", "<").replaceAll("&gt;", ">")
      .replaceAll("&quot;", `"`).replaceAll("&#39;", "'"));
    expect(problems).toEqual([REMOTE_SIZE, LOGO_SIZE, LOGO_RASTER]);
  });

  it("pass an external image with a size in pd build, said in the build's notes", async () => {
    const page = await get(built, "/external/");
    expect(page.status).toBe(200);
    expect(notes).toContain(EXTERNAL("layouts/framed", "https://example.com/b.png"));
  });

  it("are warnings in pd dev: the page is served, and each is said once", async () => {
    for (let i = 0; i < 2; i++) expect((await get(dev, "/")).status).toBe(200);
    const said = log.mock.calls.map(c => String(c[0]));
    for (const p of [REMOTE_SIZE, LOGO_SIZE, LOGO_RASTER]) {
      expect(said.filter(s => s === `[storefront] warning: ${p}`)).toHaveLength(1);
    }
    expect(said.filter(s => s === `[storefront] ${EXTERNAL("index.md", "https://example.com/a.jpg")}`)).toHaveLength(1);
  });
});
