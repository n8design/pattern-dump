// What an image file is, read from its bytes, never from its name: a link preview (og:image) needs a raster
// image, and its width and height are worth giving. PNG, JPEG, GIF and WebP carry both in their first bytes,
// so no image library is needed. Anything else — SVG included — is named by what it looks like, so the
// problem can say what was found.

export type RasterFormat = "png" | "jpeg" | "gif" | "webp";

export type ImageInfo =
  | { raster: true; format: RasterFormat; width: number; height: number }
  | { raster: false; format: "svg" | "unknown" };

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));
const u16be = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const u16le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u24le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32be = (b: Uint8Array, at: number): number => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;

/** JPEG: walk the markers to the first start-of-frame, which holds the size. */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1]!;
    if (marker === 0xff) { at++; continue; } // fill byte
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; } // no length
    at += 2 + u16be(b, at + 2);
  }
  return null;
}

/** WebP: lossy (VP8), lossless (VP8L) or extended (VP8X), each with its size in its own place. */
function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 " && b.length >= 30) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === "VP8L" && b.length >= 25) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X" && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

export function imageInfo(bytes: Uint8Array): ImageInfo {
  const b = bytes;
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    return { raster: true, format: "png", width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) {
    return { raster: true, format: "gif", width: u16le(b, 6), height: u16le(b, 8) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    if (size) return { raster: true, format: "jpeg", ...size };
  }
  if (b.length >= 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const size = webpSize(b);
    if (size) return { raster: true, format: "webp", ...size };
  }
  // SVG is text: an XML declaration, a comment, a doctype or the <svg> element itself, after any BOM or space.
  const head = new TextDecoder().decode(b.subarray(0, 1024)).replace(/^\uFEFF/, "").trimStart();
  if (/^<(\?xml|!--|!doctype svg|svg[\s>])/i.test(head) && /<svg[\s>]/i.test(head + new TextDecoder().decode(b.subarray(1024, 8192)))) {
    return { raster: false, format: "svg" };
  }
  return { raster: false, format: "unknown" };
}
