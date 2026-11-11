// A page's link-preview image (frontmatter `image`, or `storefront.image` for every page that names none):
// a file the site serves from its assets, and a raster image, read from its bytes. What it is, or why it
// can't be used.

import { readFile } from "node:fs/promises";
import { PD_ROUTE_PREFIX } from "@pattern-dump/contracts";
import { assetFile } from "../asset-file.js";
import { imageInfo, type RasterFormat } from "./image-info.js";

export type PageImage = { path: string; format: RasterFormat; width: number; height: number };
export type PageImageCheck = { ok: true; image: PageImage } | { ok: false; message: string };

const FORMATS = "PNG, JPEG, GIF or WebP";

/** Check the image at `path` (a /assets/… URL path) against the project's asset roots. */
export async function checkPageImage(path: string, roots: readonly string[], names: readonly string[]): Promise<PageImageCheck> {
  if (roots.length === 0) return { ok: false, message: `image "${path}": the project has no assets folder (assets.dir in the config)` };
  if (!path.startsWith(PD_ROUTE_PREFIX.assets)) return { ok: false, message: `image "${path}" is not in the assets: it must start with /assets/` };
  // The same lookup as the asset route: a file inside an asset root, as the file system resolves it.
  const file = await assetFile(path, roots, names);
  if (file === null) return { ok: false, message: `image "${path}" does not exist in the assets` };
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (e) {
    return { ok: false, message: `image "${path}" cannot be read: ${(e as Error).message}` };
  }
  const info = imageInfo(bytes);
  if (!info.raster) {
    return { ok: false, message: info.format === "svg"
      ? `image "${path}" is an SVG; link previews need a raster image (${FORMATS})`
      : `image "${path}" is not a ${FORMATS} image (read from its bytes, whatever its name)` };
  }
  return { ok: true, image: { path, format: info.format, width: info.width, height: info.height } };
}
