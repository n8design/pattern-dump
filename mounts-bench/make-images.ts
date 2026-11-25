// The bench's two images, drawn here: a 4 x 4 PNG of one colour, and an ICO that holds the same PNG. Nothing is
// copied from anywhere. The specs write them into their copies of the bench (README.md).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A PNG of `size` x `size` pixels, all one RGB colour. */
export function png(size: number, [r, g, b]: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.from([0, ...Array.from({ length: size }, () => [r, g, b]).flat()]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

/** An ICO with one image, the PNG given. */
export function ico(image: Buffer, size: number): Buffer {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); // icon
  head.writeUInt16LE(1, 4); // one image
  head[6] = size;
  head[7] = size;
  head.writeUInt16LE(1, 10); // colour planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(image.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, image]);
}

/** Writes tool/logo.png and root/favicon.ico into the bench at `dir`. */
export async function writeImages(dir: string): Promise<void> {
  const files: Record<string, Buffer> = {
    "tool/logo.png": png(4, [0x1f, 0x6f, 0xeb]),
    "root/favicon.ico": ico(png(4, [0xeb, 0x6f, 0x1f]), 4),
  };
  for (const [rel, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), bytes);
  }
}
