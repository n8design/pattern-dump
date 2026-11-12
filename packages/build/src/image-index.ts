// The images in a project's assets, indexed before rendering, so {{pd-image}} can look one up synchronously: a
// raster image's source hash (its variant keys follow from it) and its size as displayed, an SVG's size. Sizes come
// from the bytes (image-info.ts), so the index needs no sharp; whether sharp loads is recorded beside it, because a
// raster image is only served as variants when it does.
//
// Kept between indexings: a file whose stat stamp (inode, size, modification time in nanoseconds, read as bigint)
// is unchanged keeps its entry. A file rewritten in place within the same nanosecond, to the same size, would keep
// a stale entry; nanosecond times make that rare, and `fresh` (what pd build asks for) reads every file again.
import { readFile, stat } from "node:fs/promises";
import { imageInfo, svgSize } from "./image-info.js";
import { imageSourceHash, loadSharp, SharpUnavailableError } from "./images.js";

export type ImageIndexEntry =
  | { kind: "raster"; sourceHash: string; width: number; height: number }
  | { kind: "svg"; width: number; height: number }
  /** An SVG with no absolute width and height and no viewBox: its size can't be known. */
  | { kind: "svg-unsized" };

export interface ImageIndex {
  /** By URL (`/assets/…`). */
  readonly entries: ReadonlyMap<string, ImageIndexEntry>;
  /** Why sharp can't be loaded; undefined when it can. */
  readonly sharpError: SharpUnavailableError | undefined;
}

/** A file to index, and the URL it is served at. */
export interface ImageIndexFile { url: string; path: string }

export interface ImageIndexer {
  /** Indexes `files`, reusing what an earlier call read when a file's stat stamp is unchanged, unless `fresh`. */
  index(files: readonly ImageIndexFile[], options?: { fresh?: boolean }): Promise<ImageIndex>;
}

const IMAGE = /\.(?:jpe?g|png|gif|webp|svg)$/i;

/** `loadSharp` replaces the loader whose result `sharpError` reports (a caller passes its own, so a test can make it
 *  fail); the default is this package's. */
export function createImageIndexer(options: { loadSharp?: () => Promise<unknown> } = {}): ImageIndexer {
  const load = options.loadSharp ?? loadSharp;
  const known = new Map<string, { stamp: string; entry: ImageIndexEntry | null }>();
  const read = async (path: string): Promise<ImageIndexEntry | null> => {
    const bytes = await readFile(path);
    const info = imageInfo(bytes);
    if (info.raster) return { kind: "raster", sourceHash: imageSourceHash(bytes), width: info.width, height: info.height };
    if (info.format !== "svg") return null;
    const size = svgSize(bytes.toString("utf8"));
    return size ? { kind: "svg", ...size } : { kind: "svg-unsized" };
  };
  return {
    async index(files, options = {}) {
      const entries = new Map<string, ImageIndexEntry>();
      await Promise.all(files.filter(f => IMAGE.test(f.path)).map(async f => {
        let s;
        try { s = await stat(f.path, { bigint: true }); } catch { return; }
        const stamp = `${s.ino}:${s.size}:${s.mtimeNs}`;
        let cached = known.get(f.path);
        if (options.fresh || !cached || cached.stamp !== stamp) {
          let entry: ImageIndexEntry | null;
          try { entry = await read(f.path); } catch { return; }
          cached = { stamp, entry };
          known.set(f.path, cached);
        }
        if (cached.entry) entries.set(f.url, cached.entry);
      }));
      const sharpError = await load().then(() => undefined, (e: unknown) => e instanceof SharpUnavailableError ? e : new SharpUnavailableError(e));
      return { entries, sharpError };
    },
  };
}
