// {{pd-image}} served end to end, with a site override (storefront.images quality 50, the project's 75): a storefront
// page's image URLs and those of the previews the storefront's host serves resolve there, keyed with the site's
// settings; a workbench preview's resolve on the workbench's host, keyed with the project's. And a portrait stored on
// its side: the page's width and height are the encoded variant's pixels.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSharp } from "@pattern-dump/build";
import { defineConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  images: { quality: 75 },
  storefront: { pagesDir: "./pages", outDir: "./site", images: { quality: 50 } },
});
const SITE = config.storefront!.host ?? PD_HOSTS.storefront;
const WORKBENCH = PD_HOSTS.workbench;
let root = "";
let server: DevServer;

function get(path: string, host: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${host}:${server.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}
const text = async (path: string, host: string) => (await get(path, host)).body.toString("utf8");
/** Every image URL an HTML document writes: each src and each srcset candidate. */
const imageUrls = (html: string): string[] => [...new Set([
  ...[...html.matchAll(/<img [^>]*\bsrc="([^"]+)"/g)].map(m => m[1]!),
  ...[...html.matchAll(/\bsrcset="([^"]+)"/g)].flatMap(m => m[1]!.split(",").map(c => c.trim().split(/\s+/)[0]!)),
])];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-image-slots-site-"));
  await mkdir(join(root, "src", "assets", "images"), { recursive: true });
  await copyFile(join(fixtures, "photo.jpg"), join(root, "src", "assets", "images", "harbour.jpg"));
  await copyFile(join(fixtures, "portrait-exif6.jpg"), join(root, "src", "assets", "images", "tower.jpg"));
  for (const [rel, body] of Object.entries({
    "src/patterns/atoms/pic/pic.hbs": `<figure class="pic">{{pd-image image alt=alt}}</figure>\n`,
    "src/patterns/atoms/pic/pic.schema.json": JSON.stringify({ required: ["image", "alt"], properties: {
      image: { type: "string", "x-pd-image": { widths: [160, 320], sizes: "(max-width: 40rem) 100vw, 20rem" } }, alt: { type: "string" } } }),
    "src/patterns/atoms/pic/pic.json": JSON.stringify({ image: "/assets/images/harbour.jpg", alt: "A harbour" }),
    "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "pages/index.md": `---\ntitle: Home\n---\n\n<pd-atoms-pic image="/assets/images/harbour.jpg" alt="A harbour"></pd-atoms-pic>\n\n`
      + `<pd-atoms-pic image="/assets/images/tower.jpg" alt="A tower"></pd-atoms-pic>\n`,
  })) await save(join(root, rel), body);
  server = await startDevServer(config, root, { port: 0, live: false });
});
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("image variants with a site override", () => {
  it("resolve on each host with its own settings: the storefront page and its host's previews, the workbench's previews", async () => {
    const page = imageUrls(await text("/", SITE));
    const sitePreview = imageUrls(await text("/preview/atoms/pic", SITE));
    const workbenchPreview = imageUrls(await text("/preview/atoms/pic", WORKBENCH));
    expect(page.length).toBe(4); // two images, two widths each
    for (const url of [...page, ...sitePreview]) expect((await get(url, SITE)).status, `${url} on the storefront`).toBe(200);
    for (const url of workbenchPreview) expect((await get(url, WORKBENCH)).status, `${url} on the workbench`).toBe(200);
    // The same image at the same widths, keyed with different settings on each host.
    expect(sitePreview.filter(u => u.includes("/harbour."))).toEqual(page.filter(u => u.includes("/harbour.")));
    expect(workbenchPreview).not.toEqual(sitePreview);
    expect(workbenchPreview.map(u => u.replace(/\.[0-9a-f]{10}\./, "."))).toEqual(sitePreview.map(u => u.replace(/\.[0-9a-f]{10}\./, ".")));
  });

  it("writes a portrait stored on its side at the size its encoded variant has", async () => {
    const html = await text("/", SITE);
    const img = /<img src="([^"]*\/tower\.[^"]+)"[^>]*\bwidth="(\d+)" height="(\d+)"/.exec(html);
    expect(img).not.toBeNull();
    const sharp = await loadSharp();
    const { width, height } = await sharp((await get(img![1]!, SITE)).body).metadata();
    expect([Number(img![2]), Number(img![3])]).toEqual([width, height]);
    expect([width, height]).toEqual([320, 480]);
  });
});
