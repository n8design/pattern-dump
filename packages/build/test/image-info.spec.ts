// The size reader (image-info.ts) gives an image's size as it is displayed, from its bytes alone: an EXIF orientation
// of 5 to 8 swaps width and height, as sharp's auto-oriented variants do. Checked against sharp on real files, and
// for each container that can carry the tag (JPEG APP1, PNG eXIf, WebP EXIF). And an SVG's size from its attributes.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { imageInfo, svgSize } from "../src/image-info.js";
import { encodeWebp, imageSize, loadSharp } from "../src/images.js";

const fixtures = fileURLToPath(new URL("./fixtures/images/", import.meta.url));

describe("the size reader, against sharp", () => {
  it("reads every fixture at the size sharp displays it, the tagged portrait included", async () => {
    const sharp = await loadSharp();
    for (const name of ["photo.jpg", "flat.png", "alpha.png", "portrait-exif6.jpg"]) {
      const bytes = await readFile(join(fixtures, name));
      const info = imageInfo(bytes);
      expect(info.raster, name).toBe(true);
      if (!info.raster) continue;
      expect({ width: info.width, height: info.height }, name).toEqual(await imageSize(sharp, bytes));
    }
    const tagged = imageInfo(await readFile(join(fixtures, "portrait-exif6.jpg")));
    expect(tagged).toMatchObject({ width: 320, height: 480, orientation: 6 });
  });

  it("matches the encoded variant's pixels in proportion, for the tagged portrait", async () => {
    const sharp = await loadSharp();
    const bytes = await readFile(join(fixtures, "portrait-exif6.jpg"));
    const info = imageInfo(bytes);
    if (!info.raster) throw new Error("not raster");
    const variant = await sharp(await encodeWebp(sharp, bytes, 160, { quality: 75, effort: 4 })).metadata();
    expect({ width: variant.width, height: variant.height }).toEqual({ width: 160, height: Math.round(160 * info.height / info.width) });
  });

  it("reads the orientation tag in PNG (eXIf) and WebP (EXIF), each orientation 1 to 8", async () => {
    const sharp = await loadSharp();
    const source = await readFile(join(fixtures, "flat.png")); // 480 x 300
    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const format of ["png", "webp", "jpeg"] as const) {
        const bytes = await sharp(source)[format]().withMetadata({ orientation }).toBuffer();
        const info = imageInfo(bytes);
        if (!info.raster) throw new Error(`${format} ${orientation}: not raster`);
        const expected = await imageSize(sharp, bytes);
        expect({ width: info.width, height: info.height }, `${format} orientation ${orientation}`).toEqual(expected);
        expect(expected, `${format} orientation ${orientation}`).toEqual(orientation >= 5 ? { width: 300, height: 480 } : { width: 480, height: 300 });
      }
    }
  });
});

describe("an SVG's size", () => {
  it("is its width and height, or else its viewBox", () => {
    expect(svgSize(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>`)).toEqual({ width: 120, height: 80 });
    expect(svgSize(`<svg width="120px" height="80px" viewBox="0 0 12 8"></svg>`)).toEqual({ width: 120, height: 80 });
    expect(svgSize(`<?xml version="1.0"?>\n<svg viewBox="0 0 640 360" xmlns="http://www.w3.org/2000/svg"></svg>`)).toEqual({ width: 640, height: 360 });
    expect(svgSize(`<svg viewBox="-10 -10 200.5 100"></svg>`)).toEqual({ width: 201, height: 100 });
  });
  it("is unknown when it has neither, or relative sizes only", () => {
    expect(svgSize(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)).toBeNull();
    expect(svgSize(`<svg width="100%" height="50%"></svg>`)).toBeNull();
  });
});
