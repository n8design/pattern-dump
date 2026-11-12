// What an image file is, read from its bytes, never from its name: a link preview (og:image) needs a raster
// image, and its width and height are worth giving; an image placed with {{pd-image}} needs both too. PNG, JPEG,
// GIF and WebP carry them in their first bytes, so no image library is needed. Anything else — SVG included — is
// named by what it looks like, so the problem can say what was found.
//
// The size is the size as displayed: an EXIF orientation of 5 to 8 (a photo stored on its side, as a phone saves
// it) swaps width and height, as browsers and the auto-oriented variants (images.ts) do. The tag is read where
// each format keeps it: a JPEG's APP1 "Exif" segment, a PNG's eXIf chunk, a WebP's EXIF chunk.

export type RasterFormat = "png" | "jpeg" | "gif" | "webp";

export type ImageInfo =
  | { raster: true; format: RasterFormat; width: number; height: number; orientation: number }
  | { raster: false; format: "svg" | "unknown" };

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));
const u16be = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const u16le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u24le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32be = (b: Uint8Array, at: number): number => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
const u32le = (b: Uint8Array, at: number): number => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/** The orientation tag (0x0112) of a TIFF block (EXIF's layout) starting at `at`; 1 (as stored) when absent. */
function tiffOrientation(b: Uint8Array, at: number, end = b.length): number {
  if (at + 8 > end) return 1;
  const order = ascii(b, at, 2);
  if (order !== "II" && order !== "MM") return 1;
  const u16 = order === "II" ? u16le : u16be;
  const u32 = order === "II" ? u32le : u32be;
  const ifd = at + u32(b, at + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(b, ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(b, entry) === 0x0112) {
      const value = u16(b, entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** An EXIF block that may start with "Exif\0\0" before its TIFF header. */
const exifOrientation = (b: Uint8Array, at: number, end: number): number =>
  tiffOrientation(b, ascii(b, at, 4) === "Exif" ? at + 6 : at, end);

/** As displayed: orientations 5 to 8 turn the image a quarter, so its width is its stored height. */
const displayed = (size: { width: number; height: number }, orientation: number) =>
  orientation >= 5 ? { width: size.height, height: size.width, orientation } : { ...size, orientation };

/** PNG: the eXIf chunk's orientation, anywhere before the image data. */
function pngOrientation(b: Uint8Array): number {
  let at = 8;
  while (at + 8 <= b.length) {
    const length = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    if (type === "eXIf") return exifOrientation(b, at + 8, at + 8 + length);
    if (type === "IDAT" || type === "IEND") return 1;
    at += 12 + length;
  }
  return 1;
}

/** WebP: the EXIF chunk's orientation (an extended WebP's chunks follow its VP8X header). */
function webpOrientation(b: Uint8Array): number {
  let at = 12;
  while (at + 8 <= b.length) {
    const type = ascii(b, at, 4);
    const length = u32le(b, at + 4);
    if (type === "EXIF") return exifOrientation(b, at + 8, at + 8 + length);
    at += 8 + length + (length % 2);
  }
  return 1;
}

/** JPEG: walk the markers to the first start-of-frame, which holds the size; an APP1 "Exif" segment before it
 *  holds the orientation. */
function jpegSize(b: Uint8Array): { width: number; height: number; orientation: number } | null {
  let at = 2;
  let orientation = 1;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1]!;
    if (marker === 0xff) { at++; continue; } // fill byte
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, at + 5), width: u16be(b, at + 7), orientation };
    }
    if (marker === 0xe1 && ascii(b, at + 4, 6) === "Exif\0\0") orientation = tiffOrientation(b, at + 10, at + 2 + u16be(b, at + 2));
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
    return { raster: true, format: "png", ...displayed({ width: u32be(b, 16), height: u32be(b, 20) }, pngOrientation(b)) };
  }
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) {
    return { raster: true, format: "gif", width: u16le(b, 6), height: u16le(b, 8), orientation: 1 };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    if (size) return { raster: true, format: "jpeg", ...displayed(size, size.orientation) };
  }
  if (b.length >= 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const size = webpSize(b);
    if (size) return { raster: true, format: "webp", ...displayed(size, webpOrientation(b)) };
  }
  // SVG is text: an XML declaration, a comment, a doctype or the <svg> element itself, after any BOM or space.
  const head = new TextDecoder().decode(b.subarray(0, 1024)).replace(/^\uFEFF/, "").trimStart();
  if (/^<(\?xml|!--|!doctype svg|svg[\s>])/i.test(head) && /<svg[\s>]/i.test(head + new TextDecoder().decode(b.subarray(1024, 8192)))) {
    return { raster: false, format: "svg" };
  }
  return { raster: false, format: "unknown" };
}

/** An SVG's size in pixels: its width and height attributes when both are absolute lengths (a number, or px),
 *  else its viewBox's (rounded up); null when it has neither, as with relative sizes only. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const attr = (name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(root)?.[1];
  const px = (v: string | undefined): number | null => {
    const m = v === undefined ? null : /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(v);
    return m ? Number(m[1]) : null;
  };
  const w = px(attr("width")), h = px(attr("height"));
  if (w && h) return { width: Math.ceil(w), height: Math.ceil(h) };
  const box = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (box && box.length === 4 && box[2]! > 0 && box[3]! > 0) return { width: Math.ceil(box[2]!), height: Math.ceil(box[3]!) };
  return null;
}
