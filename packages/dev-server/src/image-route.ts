// GET /_pd/images/<name>.<hash>.<width>.webp: a responsive image variant (contracts' imageUrl). `name` is an asset's
// path without its extension; the source is found the way the asset route finds a file (asset-file.ts, inside its
// root, path containment included), trying each raster extension, and it is the one whose variant key equals
// `hash`. So two sources with the same name (harbour.jpg, harbour.png) are told apart, and a URL whose source
// changed no longer matches anything: 404. A width beyond the source's is a 404 too: a variant is never upscaled.
//
// Encoded on first request, then served from the cache (build's image module), immutable: the URL names the bytes.
// The encoding (quality, effort) is the project's, or on the storefront's host the site's override, and is part of
// the key. sharp that can't be loaded is a 500 naming it, which pd build reports as the page's problem.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import {
  createImageCache, encodeWebp, imageSize, imageVariantKey, loadSharp, SharpUnavailableError,
  type ImageCache, type ImageEncoding, type SharpModule,
} from "@pattern-dump/build";
import { parseImageUrl, PD_ROUTE_PREFIX } from "@pattern-dump/contracts";
import { assetFile } from "./asset-file.js";
import type { ResolvedConfig } from "./server-config.js";

/** The raster formats a variant can be made from, in the order a name's source is looked for. */
const RASTER = ["jpg", "jpeg", "png", "gif", "webp"] as const;

/** Where a project's variants are cached: under its node_modules, so a reboot keeps them and CI can cache them. */
export function imageCacheDir(cwd: string): string {
  return join(cwd, "node_modules", ".cache", "pattern-dump", "images");
}

const caches = new WeakMap<ResolvedConfig, ImageCache>();
const cacheFor = (cfg: ResolvedConfig): ImageCache => {
  let cache = caches.get(cfg);
  if (!cache) { cache = createImageCache(imageCacheDir(cfg.cwd)); caches.set(cfg, cache); }
  return cache;
};

/** The source whose variant at `width`, encoded with `encoding`, has the key `hash`; null when none has. */
async function variantSource(name: string, hash: string, width: number, encoding: ImageEncoding, cfg: ResolvedConfig): Promise<Uint8Array | null> {
  const base = PD_ROUTE_PREFIX.assets + name.split("/").map(encodeURIComponent).join("/");
  for (const ext of RASTER) {
    const file = await assetFile(`${base}.${ext}`, cfg.assetRoots, cfg.assetRootNames);
    if (!file) continue;
    let bytes: Uint8Array;
    try { bytes = await readFile(file); } catch { continue; }
    if (imageVariantKey(bytes, width, encoding) === hash) return bytes;
  }
  return null;
}

/** Answers a request under PD_ROUTE_PREFIX.images. `host` is the request's host name, without its port. */
export async function serveImageVariant(pathname: string, host: string, res: ServerResponse, cfg: ResolvedConfig): Promise<void> {
  const notFound = (): void => { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Image variant not found"); };
  const variant = parseImageUrl(pathname);
  if (!variant) return notFound();
  const encoding = cfg.storefront && host === cfg.storefront.host ? cfg.storefront.images : cfg.images;
  const source = await variantSource(variant.name, variant.hash, variant.width, encoding, cfg);
  if (!source) return notFound();

  let sharp: SharpModule;
  try {
    sharp = await loadSharp();
  } catch (e) {
    if (!(e instanceof SharpUnavailableError)) throw e;
    console.error(`[dev-server] ${e.message}`);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(e.message);
    return;
  }
  if (variant.width > (await imageSize(sharp, source)).width) return notFound();

  const cache = cacheFor(cfg);
  let bytes = await cache.read(variant.hash);
  if (!bytes) {
    bytes = await encodeWebp(sharp, source, variant.width, encoding);
    await cache.write(variant.hash, bytes);
  }
  res.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" });
  res.end(bytes);
}
