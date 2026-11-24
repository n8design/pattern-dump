// GET /_pd/social/<route>/card.<hash>.png: a site page's social image (contracts' socialImageUrl, social-images.ts).
// The bytes are a file: the cache's `<hash>.png`, else the card `pd social` committed beside the pages folder at that
// route and hash, served as it is (never copied into the cache). Immutable: the URL names the bytes. Anything else
// is a 404.
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { parseSocialImageUrl } from "@pattern-dump/contracts";
import { socialCacheDir } from "./image-route.js";
import type { ResolvedConfig } from "./server-config.js";
import { cardFile, socialDir } from "./storefront/social-images.js";

/** Where a project's cards are looked for: its cache, and the committed folder of its site. */
export function cardDirs(cfg: ResolvedConfig): { cache: string; committed: string } | undefined {
  return cfg.storefront ? { cache: socialCacheDir(cfg.cwd), committed: socialDir(cfg.storefront.pagesDir) } : undefined;
}

/** Answers a request under PD_ROUTE_PREFIX.social. */
export async function serveSocialImage(pathname: string, res: ServerResponse, cfg: ResolvedConfig): Promise<void> {
  const notFound = (): void => { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Social image not found"); };
  const card = parseSocialImageUrl(pathname);
  const dirs = cardDirs(cfg);
  if (!card || !dirs || !cfg.storefront?.socialImages) return notFound();
  const file = await cardFile(card.route, card.hash, dirs);
  if (!file) return notFound();
  let bytes: Buffer;
  try { bytes = await readFile(file); } catch { return notFound(); }
  res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
  res.end(bytes);
}
