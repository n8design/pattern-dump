// A page's link-preview image (frontmatter `image`, or `storefront.image` for every page that names none):
// a file the site serves from its assets, and a raster image, read from its bytes. What it is, or why it
// can't be used.

import { readFile } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";
import { assetFileFor } from "../asset-file.js";
import { imageInfo, type RasterFormat } from "./image-info.js";

export type PageImage = { path: string; format: RasterFormat; width: number; height: number };
export type PageImageCheck = { ok: true; image: PageImage } | { ok: false; message: string };

const FORMATS = "PNG, JPEG, GIF or WebP";

/** Check the image at `path` (a /assets/… URL path) against the project's asset roots. */
export async function checkPageImage(path: string, roots: readonly string[], names: readonly string[]): Promise<PageImageCheck> {
  const file = assetFileFor(path, roots, names);
  if (file === null) {
    return { ok: false, message: roots.length === 0
      ? `image "${path}": the project has no assets folder (assets.dir in the config)`
      : `image "${path}" is not in the assets: it must start with /assets/` };
  }
  // The file must be inside an asset root: "/assets/../secret.png" names no asset.
  const inside = roots.some(root => { const rel = relative(root, file); return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel); });
  if (!inside) return { ok: false, message: `image "${path}" is outside the assets folder` };
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, message: code === "ENOENT" || code === "EISDIR"
      ? `image "${path}" does not exist in the assets`
      : `image "${path}" cannot be read: ${(e as Error).message}` };
  }
  const info = imageInfo(bytes);
  if (!info.raster) {
    return { ok: false, message: info.format === "svg"
      ? `image "${path}" is an SVG; link previews need a raster image (${FORMATS})`
      : `image "${path}" is not a ${FORMATS} image (read from its bytes, whatever its name)` };
  }
  return { ok: true, image: { path, format: info.format, width: info.width, height: info.height } };
}
