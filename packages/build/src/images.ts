// Responsive image variants: an asset re-encoded as WebP at a given width, by sharp (libvips), never wider than
// its source. sharp is pinned to one exact version (SHARP_VERSION): the same source, width and settings give the
// same bytes on macOS, Linux and in WebContainers, so a variant can be named by its key before it is encoded, and
// a built site is the same on every machine.
//
// sharp loads a native binary for the platform (an optional dependency npm picks), or its WebAssembly build. When
// neither loads, that is a named error, never a silent fallback.
//
// Variants are cached on disk by their key, so an image is encoded once until it changes.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Sharp from "sharp";

/** The sharp release Pattern Dump pins. A variant's key includes it: another release may encode other bytes. */
export const SHARP_VERSION = "0.35.5";

export type SharpModule = typeof Sharp;

/** How a variant is encoded, besides its width. */
export interface ImageEncoding {
  /** WebP quality, 1 to 100. */
  quality: number;
  /** WebP effort, 0 (fastest) to 6 (smallest). */
  effort: number;
}

/** sharp could not be loaded: no binary for this platform was installed, or it failed to load. */
export class SharpUnavailableError extends Error {
  constructor(cause: unknown) {
    const why = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
    super(`Pattern Dump could not load sharp, which encodes its responsive images (${why}). `
      + `npm installs sharp's binary for ${process.platform}-${process.arch} as an optional dependency: `
      + `reinstall without --omit=optional (or --no-optional).`, { cause });
    this.name = "SharpUnavailableError";
  }
}

let loaded: Promise<SharpModule> | undefined;

/** sharp, loaded once per process; a failure is a SharpUnavailableError (a missing binary doesn't appear while
 *  the process runs). `importer` replaces the import for tests, and its result is never shared. */
export function loadSharp(importer?: () => Promise<{ default: SharpModule }>): Promise<SharpModule> {
  if (!importer && loaded) return loaded;
  const attempt = (importer ?? (() => import("sharp") as Promise<{ default: SharpModule }>))().then(
    m => m.default,
    (e: unknown) => { throw new SharpUnavailableError(e); },
  );
  if (!importer) loaded = attempt;
  return attempt;
}

/**
 * A variant's key: the first 10 hex digits of a SHA-256 over the source's bytes and everything its bytes depend
 * on (format, that it is auto-oriented, width, quality, effort, sharp's version). It names the variant before it is encoded, and changes
 * exactly when the variant's bytes would.
 */
export function imageVariantKey(source: Uint8Array, width: number, encoding: ImageEncoding): string {
  const sourceHash = createHash("sha256").update(source).digest("hex");
  return createHash("sha256")
    .update(`${sourceHash}|webp|orient=auto|w=${width}|q=${encoding.quality}|e=${encoding.effort}|sharp=${SHARP_VERSION}`)
    .digest("hex").slice(0, 10);
}

/** The source's pixel size as it is displayed: an EXIF orientation of 5 to 8 swaps width and height, as the
 *  encoded variant does. Read by sharp from the header. */
export async function imageSize(sharp: SharpModule, source: Uint8Array): Promise<{ width: number; height: number }> {
  const meta = await sharp(source).metadata();
  return { width: meta.autoOrient?.width ?? meta.width ?? 0, height: meta.autoOrient?.height ?? meta.height ?? 0 };
}

/** The variant: WebP, turned upright by its EXIF orientation, `width` pixels wide, height in proportion, never
 *  wider than the source as displayed. Metadata is dropped (sharp's default), so a variant's bytes depend only
 *  on the pixels, and no orientation tag is left to turn it again. */
export function encodeWebp(sharp: SharpModule, source: Uint8Array, width: number, encoding: ImageEncoding): Promise<Buffer> {
  return sharp(source, { autoOrient: true }).resize({ width, withoutEnlargement: true })
    .webp({ quality: encoding.quality, effort: encoding.effort }).toBuffer();
}

export interface ImageCache {
  /** The cached variant, or undefined. */
  read(key: string): Promise<Buffer | undefined>;
  /** Stores a variant; written to a temporary name first, so a reader never sees half a file. */
  write(key: string, bytes: Uint8Array): Promise<void>;
  /** Removes every cached variant whose key isn't in `keep` (a full build keeps what it used). Returns how many. */
  sweep(keep: ReadonlySet<string>): Promise<number>;
}

/** Variants cached in `dir`, one `<key>.webp` file each. Content-addressed, so an entry is never stale. */
export function createImageCache(dir: string): ImageCache {
  const file = (key: string): string => join(dir, `${key}.webp`);
  return {
    async read(key) {
      try { return await readFile(file(key)); } catch { return undefined; }
    },
    async write(key, bytes) {
      await mkdir(dir, { recursive: true });
      const temp = `${file(key)}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, bytes);
      await rename(temp, file(key));
    },
    async sweep(keep) {
      let names: string[];
      try { names = await readdir(dir); } catch { return 0; }
      let removed = 0;
      for (const name of names) {
        const m = /^([0-9a-f]{10})\.webp$/.exec(name);
        if (m && !keep.has(m[1]!)) { await rm(join(dir, name), { force: true }); removed++; }
      }
      return removed;
    },
  };
}
