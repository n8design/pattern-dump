// The image index (image-index.ts): what it records per image, and when it reads a file again. Between two indexings
// a file whose stat stamp (inode, size, mtime in ns) is unchanged keeps its entry; pd build asks for `fresh`, which
// reads every file again whatever its stamp says.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createImageIndexer } from "../src/image-index.js";
import { imageSourceHash } from "../src/images.js";
import { save } from "../../../test-support/save.js";

const fixtures = fileURLToPath(new URL("./fixtures/images/", import.meta.url));
let dir = "";
const file = (name: string) => ({ url: `/assets/${name}`, path: join(dir, name) });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pd-image-index-"));
  await copyFile(join(fixtures, "portrait-exif6.jpg"), join(dir, "tower.jpg"));
  await save(join(dir, "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"></svg>\n`);
  await save(join(dir, "loose.svg"), `<svg xmlns="http://www.w3.org/2000/svg"></svg>\n`);
  await save(join(dir, "notes.txt"), "not an image\n");
});
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe("the image index", () => {
  it("records a raster image's source hash and size as displayed, an SVG's size, and skips what isn't an image", async () => {
    const index = await createImageIndexer().index(["tower.jpg", "logo.svg", "loose.svg", "notes.txt"].map(file));
    expect(Object.fromEntries(index.entries)).toEqual({
      "/assets/tower.jpg": { kind: "raster", sourceHash: imageSourceHash(await readFile(join(dir, "tower.jpg"))), width: 320, height: 480 },
      "/assets/logo.svg": { kind: "svg", width: 64, height: 32 },
      "/assets/loose.svg": { kind: "svg-unsized" },
    });
    expect(index.sharpError).toBeUndefined();
  });

  it("keeps an entry while the stamp holds, reads it again when the stamp changes, and always when fresh", async () => {
    const indexer = createImageIndexer();
    const path = join(dir, "same-size.svg");
    const a = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"></svg>\n`;
    const b = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"></svg>\n`; // same length as a
    await save(path, a);
    const when = new Date("2026-01-02T03:04:05.000Z");
    await utimes(path, when, when);
    const before = await stat(path, { bigint: true });
    expect((await indexer.index([file("same-size.svg")])).entries.get("/assets/same-size.svg")).toEqual({ kind: "svg", width: 10, height: 20 });

    // Rewritten in place (same inode), same size, and its times put back: the stamp is the same.
    await writeFile(path, b);
    await utimes(path, when, when);
    const after = await stat(path, { bigint: true });
    expect([after.ino, after.size, after.mtimeNs]).toEqual([before.ino, before.size, before.mtimeNs]);
    expect((await indexer.index([file("same-size.svg")])).entries.get("/assets/same-size.svg")).toEqual({ kind: "svg", width: 10, height: 20 });
    expect((await indexer.index([file("same-size.svg")], { fresh: true })).entries.get("/assets/same-size.svg")).toEqual({ kind: "svg", width: 30, height: 40 });

    // A save (a new file, so a new inode and time): read again without fresh.
    await save(path, a);
    expect((await indexer.index([file("same-size.svg")])).entries.get("/assets/same-size.svg")).toEqual({ kind: "svg", width: 10, height: 20 });
  });
});
