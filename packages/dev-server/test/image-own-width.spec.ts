// An image narrower than a slot's next width reaches its own width (renderer imageTag): a 602 px image in a slot of
// 480 and 960 gets 480w and 602w, never 960w (no upscaling), and the 602 variant is served at 602 px. The same for a
// markdown image from the assets, an image beside a page, and {{pd-image}}, through the server pd build crawls.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "../src/index.js";
import { save } from "../../../test-support/save.js";

const SLOT = { widths: [480, 960], sizes: "100vw" };
let tmp = "", server: DevServer;

/** A PNG of one colour at `width` x `width / 2`, made here for the test. */
const png = (width: number) => sharp({ create: { width, height: width / 2, channels: 3, background: { r: 30, g: 110, b: 235 } } }).png().toBuffer();

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-image-own-width-"));
  const text: Record<string, string> = {
    "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } }, "x-pd-prose-images": SLOT }),
    "src/patterns/atoms/pic/pic.hbs": `{{pd-image image alt="A chart"}}\n`,
    "src/patterns/atoms/pic/pic.schema.json": JSON.stringify({ properties: { image: { type: "string", "x-pd-image": SLOT } } }),
    "src/patterns/atoms/pic/pic.json": JSON.stringify({ image: "/assets/images/chart.png" }),
    "src/styles/x.scss": "",
    "pages/index.md": "---\ntitle: Home\n---\n\n![From the assets](/assets/images/chart.png)\n\n![Beside the page](./beside.png)\n",
  };
  for (const [rel, body] of Object.entries(text)) await save(join(tmp, rel), body);
  for (const rel of ["src/assets/images/chart.png", "pages/beside.png"]) await save(join(tmp, rel), await png(602));
  const config = validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
    storefront: { pagesDir: "./pages", outDir: "./site", url: "https://site.test/", workbenchUrl: "https://wb.test/" },
  }), "test");
  server = await startDevServer(config, tmp, { port: 0, wsPort: 0, live: false });
}, 60_000);
afterAll(async () => { await server?.close(); if (tmp) await rm(tmp, { recursive: true, force: true }); });

const get = (path: string, host: string) => new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
  request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${host}:${server.port}` } }, res => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
  }).on("error", reject).end();
});
/** Each <img srcset> of a document: its widths, and its URLs by width. */
const srcsets = (html: string) => [...html.matchAll(/<img [^>]*srcset="([^"]+)"/g)].map(m => m[1]!.split(", ").map(c => {
  const [url, w] = c.split(" ");
  return { url: url!.replace(/&#x3D;/g, "="), width: Number(w!.slice(0, -1)) };
}));

describe("an image between two slot widths", () => {
  it("in a page, from the assets and beside the page: 480w and 602w, nothing wider, the 602 variant at 602 px", { timeout: 60_000 }, async () => {
    const page = await get("/", PD_HOSTS.storefront);
    expect(page.status).toBe(200);
    const sets = srcsets(page.body.toString());
    expect(sets).toHaveLength(2);
    for (const set of sets) {
      expect(set.map(c => c.width)).toEqual([480, 602]);
      const own = await get(set[1]!.url, PD_HOSTS.storefront);
      expect(own.status).toBe(200);
      expect((await sharp(own.body).metadata()).width).toBe(602);
    }
    expect(page.body.toString()).toMatch(/<img [^>]*width="602" height="301"/);
  });

  it("through {{pd-image}}: the same", { timeout: 60_000 }, async () => {
    const preview = await get("/preview/atoms/pic", PD_HOSTS.workbench);
    const [set] = srcsets(preview.body.toString());
    expect(set!.map(c => c.width)).toEqual([480, 602]);
    const own = await get(set![1]!.url, PD_HOSTS.workbench);
    expect([own.status, (await sharp(own.body).metadata()).width]).toEqual([200, 602]);
  });
});
