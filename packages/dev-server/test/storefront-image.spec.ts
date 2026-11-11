// A page's link-preview image: its format and size read from its bytes (image-info.ts), and the file checked
// against the project's assets (page-image.ts). Every test image is built here byte by byte, so the size
// fields each format keeps in a different place are pinned exactly.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageInfo } from "../src/storefront/image-info.js";
import { checkPageImage } from "../src/storefront/page-image.js";
import { save } from "../../../test-support/save.js";

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  Uint8Array.from(parts.flatMap(p => typeof p === "string" ? [...p].map(c => c.charCodeAt(0)) : p));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

const png = (w: number, h: number) => bytes([0x89], "PNG", [13, 10, 26, 10], be32(13), "IHDR", be32(w), be32(h), [8, 6, 0, 0, 0]);
const gif = (w: number, h: number) => bytes("GIF89a", le16(w), le16(h), [0, 0, 0]);
/** A JPEG with an APP0 segment before its frame header, so the walk has to skip one. */
const jpeg = (w: number, h: number, sof = 0xc0) => bytes([0xff, 0xd8], [0xff, 0xe0], be16(16), "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
  [0xff, 0xc4], be16(4), [0, 0], [0xff, sof], be16(17), [8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const riff = (chunk: string, payload: number[]) => bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0], payload);
const webpLossy = (w: number, h: number) => riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]);
const webpLossless = (w: number, h: number) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return riff("VP8L", [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255]);
};
const webpExtended = (w: number, h: number) => riff("VP8X", [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);

describe("imageInfo — raster formats, size from the bytes", () => {
  it("PNG", () => expect(imageInfo(png(1200, 630))).toEqual({ raster: true, format: "png", width: 1200, height: 630 }));
  it("GIF", () => expect(imageInfo(gif(300, 200))).toEqual({ raster: true, format: "gif", width: 300, height: 200 }));
  it("JPEG, its frame header found past other segments", () => {
    expect(imageInfo(jpeg(1200, 630))).toEqual({ raster: true, format: "jpeg", width: 1200, height: 630 });
  });
  it("JPEG, progressive (SOF2)", () => expect(imageInfo(jpeg(800, 418, 0xc2))).toMatchObject({ format: "jpeg", width: 800, height: 418 }));
  it("WebP: lossy, lossless and extended", () => {
    expect(imageInfo(webpLossy(1200, 630))).toEqual({ raster: true, format: "webp", width: 1200, height: 630 });
    expect(imageInfo(webpLossless(1200, 630))).toEqual({ raster: true, format: "webp", width: 1200, height: 630 });
    expect(imageInfo(webpExtended(1200, 630))).toEqual({ raster: true, format: "webp", width: 1200, height: 630 });
  });
});

describe("imageInfo — what is not a raster image", () => {
  it("SVG, however it starts", () => {
    for (const svg of [`<svg xmlns="http://www.w3.org/2000/svg"/>`, `<?xml version="1.0"?>\n<svg>`, `\uFEFF  <!-- logo -->\n<svg viewBox="0 0 1 1">`,
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg>`]) {
      expect(imageInfo(new TextEncoder().encode(svg)), svg).toEqual({ raster: false, format: "svg" });
    }
  });
  it("anything else, and a raster header cut short", () => {
    for (const other of [bytes("hello"), bytes([]), bytes("<html><body></body></html>"), png(1, 1).subarray(0, 20), bytes([0xff, 0xd8, 0xff, 0xd9])]) {
      expect(imageInfo(other)).toEqual({ raster: false, format: "unknown" });
    }
  });
});

describe("checkPageImage — the file in the assets", () => {
  let tmp = "", one = "", two = "";
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "pd-page-image-"));
    one = join(tmp, "assets");
    two = join(tmp, "brand");
    await mkdir(join(one, "images"), { recursive: true });
    await mkdir(two, { recursive: true });
    await save(join(one, "images", "share.png"), Buffer.from(png(1200, 630)));
    await save(join(one, "images", "renamed.jpg"), Buffer.from(png(640, 480)));
    await save(join(one, "images", "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg"/>`);
    await save(join(one, "images", "notes.txt"), "not an image");
    await save(join(two, "card.gif"), Buffer.from(gif(300, 200)));
    await save(join(tmp, "secret.png"), Buffer.from(png(1, 1)));
  });
  afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

  const check = (path: string) => checkPageImage(path, [one, two], ["assets", "brand"]);

  it("finds a raster image and reads its size", async () => {
    expect(await check("/assets/images/share.png")).toEqual({ ok: true, image: { path: "/assets/images/share.png", format: "png", width: 1200, height: 630 } });
  });
  it("reads the format from the bytes, not the name", async () => {
    expect(await check("/assets/images/renamed.jpg")).toMatchObject({ ok: true, image: { format: "png", width: 640, height: 480 } });
  });
  it("finds an image in a named root, as the asset route does", async () => {
    expect(await check("/assets/brand/card.gif")).toMatchObject({ ok: true, image: { format: "gif" } });
  });
  it("refuses an SVG, saying why", async () => {
    expect(await check("/assets/images/logo.svg")).toEqual({ ok: false,
      message: `image "/assets/images/logo.svg" is an SVG; link previews need a raster image (PNG, JPEG, GIF or WebP)` });
  });
  it("refuses a file that is no image", async () => {
    expect(await check("/assets/images/notes.txt")).toEqual({ ok: false,
      message: `image "/assets/images/notes.txt" is not a PNG, JPEG, GIF or WebP image (read from its bytes, whatever its name)` });
  });
  it("refuses a file that does not exist, and a folder", async () => {
    expect(await check("/assets/images/gone.png")).toEqual({ ok: false, message: `image "/assets/images/gone.png" does not exist in the assets` });
    expect(await check("/assets/images/x/../")).toMatchObject({ ok: false });
  });
  it("refuses a path that leaves the assets", async () => {
    expect(await check("/assets/../secret.png")).toEqual({ ok: false, message: `image "/assets/../secret.png" is outside the assets folder` });
    expect(await check("/assets/%2e%2e/secret.png")).toEqual({ ok: false, message: `image "/assets/%2e%2e/secret.png" is outside the assets folder` });
  });
  it("says so when the project has no assets", async () => {
    expect(await checkPageImage("/assets/a.png", [], [])).toEqual({ ok: false,
      message: `image "/assets/a.png": the project has no assets folder (assets.dir in the config)` });
  });
});
