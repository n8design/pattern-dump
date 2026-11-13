// The images in a project's assets, for the renderer's {{pd-image}} (RendererOptions.images): an index built before
// every render (build's image index), and the lookup that turns an entry into what the helper writes.
//
//  - A raster image whose variants can be encoded: its variant URLs (contracts' imageUrl), keyed with the project's
//    image settings, or the site's when the render asks for them (RenderInput.images, on the storefront's host).
//  - A raster image when sharp can't be loaded: pd dev and pd audit show the original at its size, and say so once;
//    pd build can't, since every image it writes is encoded (decision 10), so the page fails with the named error.
//  - An SVG: one file at its size; without one (no absolute width and height, no viewBox), it can't be placed.
//
// The index is rebuilt when the generation changes (pd dev: every handled change; a file whose stat stamp holds keeps
// its entry). pd build has one generation and reads every file fresh.
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  createImageIndexer, imageVariantKeyFromSourceHash, loadSharp,
  type ImageEncoding, type ImageIndex,
} from "@pattern-dump/build";
import { imageUrl, PD_ROUTE_PREFIX, type ImageLookup, type ImageSource } from "@pattern-dump/contracts";

export interface ImageServiceOptions {
  assetRoots: readonly string[];
  assetRootNames: readonly string[];
  /** The project's image settings, and the site's (its override over them), when there is a storefront. */
  images: ImageEncoding;
  siteImages?: ImageEncoding;
  /** pd build: every image must be encoded, and every file is read fresh. pd dev and pd audit: not. */
  build: boolean;
  /** Said once, when an original is shown because sharp can't be loaded. */
  warn: (message: string) => void;
}

export interface ImageService {
  /** Brings the index up to `generation`; a render awaits it first. */
  ready(generation: string): Promise<void>;
  lookup: ImageLookup;
}

/** Every file under the asset roots, at the URL the asset route serves it at (asset-file.ts): with several roots
 *  /assets/<root's folder name>/…, and the first root's files at /assets/… too. */
async function assetFiles(roots: readonly string[], names: readonly string[]): Promise<Array<{ url: string; path: string }>> {
  const files: Array<{ url: string; path: string }> = [];
  for (const [i, root] of roots.entries()) {
    const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isFile()) continue;
      const path = join(e.parentPath, e.name);
      const rel = relative(root, path).split(sep).join("/");
      if (roots.length > 1) files.push({ url: `${PD_ROUTE_PREFIX.assets}${names[i]}/${rel}`, path });
      if (i === 0) files.push({ url: `${PD_ROUTE_PREFIX.assets}${rel}`, path });
    }
  }
  return files;
}

export function createImageService(options: ImageServiceOptions, load: () => Promise<unknown> = loadSharp): ImageService {
  const indexer = createImageIndexer({ loadSharp: load });
  let current: { generation: string; index: ImageIndex } | undefined;
  let pending: { generation: string; promise: Promise<void> } | undefined;
  let warned = false;

  const ready = (generation: string): Promise<void> => {
    if (current?.generation === generation) return Promise.resolve();
    if (pending?.generation === generation) return pending.promise;
    const promise = (async () => {
      const index = await indexer.index(await assetFiles(options.assetRoots, options.assetRootNames), { fresh: options.build });
      current = { generation, index };
    })();
    pending = { generation, promise };
    return promise;
  };

  const lookup: ImageLookup = (src: string): ImageSource | undefined => {
    const entry = current?.index.entries.get(src);
    if (!entry) return undefined;
    if (entry.kind === "svg") return { kind: "single", url: src, width: entry.width, height: entry.height };
    if (entry.kind === "svg-unsized") {
      return { kind: "unavailable", reason: `${src} is an SVG with no width and height and no viewBox, so its size can't be known: give it a width and height or a viewBox` };
    }
    const sharpError = current!.index.sharpError;
    if (sharpError) {
      if (options.build) return { kind: "unavailable", reason: sharpError.message };
      if (!warned) { warned = true; options.warn(`${sharpError.message} Until it loads, images are shown as they are, not as variants.`); }
      return { kind: "single", url: src, width: entry.width, height: entry.height };
    }
    const name = src.slice(PD_ROUTE_PREFIX.assets.length).replace(/\.[^./]+$/, "");
    return {
      kind: "variants", width: entry.width, height: entry.height,
      variantUrl: (width, settings) => imageUrl(name,
        imageVariantKeyFromSourceHash(entry.sourceHash, width, settings === "site" && options.siteImages ? options.siteImages : options.images), width),
    };
  };

  return { ready, lookup };
}
