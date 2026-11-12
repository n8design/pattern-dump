// GET /_pd/images/<name>.<hash>.<width>.webp (image-route.ts), on a small project with a storefront: a variant is
// encoded once and served immutable; the URL's hash picks the source and the encoding; no upscaling; and the
// route reads only inside the assets folder, as the asset route does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWebp, imageVariantKey, loadSharp } from "@pattern-dump/build";
import { defineConfig } from "@pattern-dump/config";
import { imageUrl, PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { readFile } from "node:fs/promises";
import { save } from "../../../test-support/save.js";

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
const PROJECT = { quality: 75, effort: 4 };
const SITE = { quality: 50, effort: 4 };
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  storefront: { pagesDir: "./pages", outDir: "./site", images: { quality: SITE.quality } },
});
let tmp = "";
let root = "";
let server: DevServer;
let photo: Buffer;
let png: Buffer;

function get(path: string, host = "127.0.0.1"): Promise<{ status: number; type: string | undefined; cache: string | undefined; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${host}:${server.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: res.headers["content-type"], cache: res.headers["cache-control"], body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-image-route-"));
  root = join(tmp, "site-project");
  await mkdir(join(root, "src", "assets", "images"), { recursive: true });
  await save(join(root, "src", "patterns", "atoms", "a", "a.hbs"), "<p>a</p>\n");
  await save(join(root, "pages", "index.md"), "---\ntitle: Home\n---\n\nHome.\n");
  await copyFile(join(fixtures, "photo.jpg"), join(root, "src", "assets", "images", "harbour.jpg"));
  await copyFile(join(fixtures, "alpha.png"), join(root, "src", "assets", "images", "harbour.png"));
  await copyFile(join(fixtures, "portrait-exif6.jpg"), join(root, "src", "assets", "images", "tower.jpg"));
  // Sentinels: raster images outside the assets folder, in the project and above it.
  await copyFile(join(fixtures, "flat.png"), join(root, "outside.png"));
  await copyFile(join(fixtures, "flat.png"), join(tmp, "outside.png"));
  photo = await readFile(join(fixtures, "photo.jpg"));
  png = await readFile(join(fixtures, "alpha.png"));
  server = await startDevServer(config, root, { port: 0, live: false });
});
afterAll(async () => {
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("the image variant route", () => {
  it("serves the variant its URL names, as WebP, immutable, and keeps it in the project's cache", async () => {
    const key = imageVariantKey(photo, 240, PROJECT);
    const res = await get(imageUrl("images/harbour", key, 240));
    expect([res.status, res.type, res.cache]).toEqual([200, "image/webp", "public, max-age=31536000, immutable"]);
    const sharp = await loadSharp();
    expect(res.body.equals(await encodeWebp(sharp, photo, 240, PROJECT))).toBe(true);
    expect(await readdir(join(root, "node_modules", ".cache", "pattern-dump", "images"))).toContain(`${key}.webp`);
    expect((await get(imageUrl("images/harbour", key, 240))).body.equals(res.body)).toBe(true);
  });

  it("tells two sources with the same name apart by the hash", async () => {
    const fromPng = await get(imageUrl("images/harbour", imageVariantKey(png, 160, PROJECT), 160));
    expect(fromPng.status).toBe(200);
    const sharp = await loadSharp();
    expect((await sharp(fromPng.body).metadata()).hasAlpha).toBe(true); // the PNG's, not the JPEG's
  });

  it("encodes with the site's settings on the storefront's host", async () => {
    const site = config.storefront!.host ?? PD_HOSTS.storefront;
    expect((await get(imageUrl("images/harbour", imageVariantKey(photo, 240, SITE), 240), site)).status).toBe(200);
    expect((await get(imageUrl("images/harbour", imageVariantKey(photo, 240, PROJECT), 240), site)).status).toBe(404);
    expect((await get(imageUrl("images/harbour", imageVariantKey(photo, 240, SITE), 240))).status).toBe(404);
  });

  it("is a 404 for a hash no source has, a width beyond the source's, and a malformed URL", async () => {
    expect((await get(imageUrl("images/harbour", "0123456789", 240))).status).toBe(404);
    expect((await get(imageUrl("images/harbour", imageVariantKey(photo, 960, PROJECT), 960))).status).toBe(404); // photo is 480 wide
    expect((await get(imageUrl("images/nope", imageVariantKey(photo, 240, PROJECT), 240))).status).toBe(404);
    expect((await get("/_pd/images/images/harbour.webp")).status).toBe(404);
  });

  it("serves a photo upright, and only up to its width as displayed", async () => {
    const tagged = await readFile(join(fixtures, "portrait-exif6.jpg")); // stored 480 x 320, orientation 6
    const res = await get(imageUrl("images/tower", imageVariantKey(tagged, 160, PROJECT), 160));
    expect(res.status).toBe(200);
    const sharp = await loadSharp();
    const { width, height } = await sharp(res.body).metadata();
    expect({ width, height }).toEqual({ width: 160, height: 240 });
    expect((await get(imageUrl("images/tower", imageVariantKey(tagged, 320, PROJECT), 320))).status).toBe(200);
    expect((await get(imageUrl("images/tower", imageVariantKey(tagged, 480, PROJECT), 480))).status).toBe(404); // wider than shown
  });

  it("reads nothing outside the assets folder, whatever the name climbs to", async () => {
    const sentinel = await readFile(join(fixtures, "flat.png"));
    for (const depth of [2, 3, 4]) {
      const key = imageVariantKey(sentinel, 160, PROJECT);
      for (const up of ["..%2F", "%2e%2e%2F", "..%5C"]) {
        const path = `/_pd/images/${up.repeat(depth)}outside.${key}.160.webp`;
        const res = await get(path);
        expect(res.status, path).toBe(404);
      }
      for (const up of ["../", "%2e%2e/"]) {
        const path = `/_pd/images/images/${up.repeat(depth)}outside.${key}.160.webp`;
        expect((await get(path)).status, path).toBe(404);
      }
    }
  });
});
