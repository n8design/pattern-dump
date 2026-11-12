// The image module (images.ts): loading sharp and its named error, the variant key, encoding, the cache.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createImageCache, encodeWebp, imageSize, imageVariantKey, loadSharp, SHARP_VERSION, SharpUnavailableError,
} from "../src/images.js";

const fixtures = fileURLToPath(new URL("./fixtures/images/", import.meta.url));
const ENC = { quality: 75, effort: 4 };

describe("loading sharp", () => {
  it("names the failure when sharp can't be loaded, with what to do", async () => {
    const missing = () => Promise.reject(new Error("Could not load the \"sharp\" module using the darwin-arm64 runtime\nPossible solutions: …"));
    const failure = await loadSharp(missing).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SharpUnavailableError);
    expect((failure as Error).message).toBe(
      `Pattern Dump could not load sharp, which encodes its responsive images (Could not load the "sharp" module using the darwin-arm64 runtime). `
      + `npm installs sharp's binary for ${process.platform}-${process.arch} as an optional dependency: reinstall without --omit=optional (or --no-optional).`);
  });

  it("keeps a test's failing import to itself: the real one still loads", async () => {
    await expect(loadSharp(() => Promise.reject(new Error("gone")))).rejects.toBeInstanceOf(SharpUnavailableError);
    const sharp = await loadSharp();
    expect(typeof sharp).toBe("function");
  });

  it("is the release the key names, pinned exactly", async () => {
    const require = createRequire(import.meta.url);
    const installed = JSON.parse(await readFile(join(require.resolve("sharp"), "..", "..", "package.json"), "utf8")) as { version: string };
    const pkg = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { dependencies: Record<string, string> };
    expect([installed.version, pkg.dependencies["sharp"]]).toEqual([SHARP_VERSION, SHARP_VERSION]);
  });
});

describe("a variant's key", () => {
  const source = new Uint8Array([1, 2, 3, 4]);
  it("is ten hex digits, the same for the same input", () => {
    expect(imageVariantKey(source, 480, ENC)).toMatch(/^[0-9a-f]{10}$/);
    expect(imageVariantKey(source, 480, ENC)).toBe(imageVariantKey(new Uint8Array([1, 2, 3, 4]), 480, { ...ENC }));
  });
  it("changes with the source's bytes, the width, the quality and the effort", () => {
    const base = imageVariantKey(source, 480, ENC);
    for (const other of [
      imageVariantKey(new Uint8Array([1, 2, 3, 5]), 480, ENC), imageVariantKey(source, 481, ENC),
      imageVariantKey(source, 480, { ...ENC, quality: 76 }), imageVariantKey(source, 480, { ...ENC, effort: 5 }),
    ]) expect(other).not.toBe(base);
  });
});

describe("encoding", () => {
  it("is WebP at the width asked, height in proportion, and never wider than its source", async () => {
    const sharp = await loadSharp();
    const photo = await readFile(join(fixtures, "photo.jpg"));
    const small = await encodeWebp(sharp, photo, 240, ENC);
    expect([(await sharp(small).metadata()).format, await imageSize(sharp, small)]).toEqual(["webp", { width: 240, height: 160 }]);
    const asked = await encodeWebp(sharp, photo, 2000, ENC);
    expect(await imageSize(sharp, asked)).toEqual({ width: 480, height: 320 });
  });
});

describe("the cache", () => {
  let dir = "";
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "pd-image-cache-")); });
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("keeps a variant by its key, and sweeps what a build didn't use", async () => {
    const cache = createImageCache(join(dir, "images"));
    expect(await cache.read("0123456789")).toBeUndefined();
    await cache.write("0123456789", new Uint8Array([7]));
    await cache.write("abcdefabcd", new Uint8Array([8]));
    expect([...(await cache.read("0123456789"))!]).toEqual([7]);
    expect(await cache.sweep(new Set(["abcdefabcd"]))).toBe(1);
    expect((await readdir(join(dir, "images"))).sort()).toEqual(["abcdefabcd.webp"]);
  });
});
