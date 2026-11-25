// `pd social`: the site's social images rendered into the project, to be committed, so a build on a machine without
// Chromium (a deploy host) uses them (social-images.ts: a committed card is used when its hash matches).
//
// The same cards pd build would render, from the same server: each page's head asked for once (DevServer.socialCards),
// and the scheduled pages too, so a scheduled page's card is ready on its day; never a draft. A card already committed
// at its hash is kept; one in the cache is copied; the rest are rendered in Chromium and checked as pd build checks
// them (social-render.ts). Then the folder holds exactly those cards: an old hash at a route, and a route with no card
// any more (a page deleted, `socialImage: false`, a page that now sets `image`), are removed, and the folders left
// empty. One card with a problem and nothing is written or removed. pd build never writes into the folder.

import { mkdir, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { createImageCache } from "@pattern-dump/build";
import { PD_ROUTES, type StorefrontPagesResponse } from "@pattern-dump/contracts";
import type { PatternDumpConfig } from "@pattern-dump/config";
import { startDevServer } from "./index.js";
import { socialCacheDir } from "./image-route.js";
import { loadPatternPackages } from "./packages.js";
import { resolveServerConfig } from "./server-config.js";
import { BrowserUnavailableError, launchChromium, loadProjectPlaywright, type PlaywrightModule } from "./storefront/browser-checks.js";
import { hostTransport } from "./storefront/crawl.js";
import { committedCardFile, socialDir } from "./storefront/social-images.js";
import { CARD_CHROMIUM_ARGS, renderCards } from "./storefront/social-render.js";

export interface SocialImagesOptions {
  /** Pattern Dump's version: part of every card's hash, as in pd build. */
  pdVersion: string;
  /** Where Playwright comes from. Default: the project's own (loadProjectPlaywright). */
  loadPlaywright?: (root: string) => Promise<PlaywrightModule>;
  log?: (line: string) => void;
}

export interface SocialImagesReport {
  /** The folder written, absolute. */
  dir: string;
  /** Cards the site needs. */
  cards: number;
  /** Of them: rendered now, copied from the cache, already committed at their hash. */
  rendered: number;
  fromCache: number;
  current: number;
  /** Card files removed: old hashes, and routes with no card. */
  removed: number;
}

/** A card file of the committed folder, by its name: `card.<hash>.png`. */
const CARD_FILE = /^card\.[0-9a-f]{10}\.png$/;

/** `pd social`: render the site's social images into `<site>/social/`. */
export async function renderSocialImages(config: PatternDumpConfig, root: string, opts: SocialImagesOptions): Promise<SocialImagesReport> {
  const cfg = resolveServerConfig(config, root, {}, loadPatternPackages(config.packages, root));
  const site = cfg.storefront;
  if (!site) throw new Error("pd social: the project has no site, so there are no social images to render");
  if (!site.socialImages) {
    throw new Error("pd social: site.socialImages is not set, so there are no social images to render: set site.socialImages.component");
  }
  const playwright = await (opts.loadPlaywright ?? (r => loadProjectPlaywright(r, "pd social")))(cfg.cwd);
  const dir = socialDir(site.pagesDir);
  const server = await startDevServer(config, root, { port: 0, live: false, pagesOnce: true, scheduled: "show", version: opts.pdVersion });
  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    const get = hostTransport(server.port, site.host, site.basePath);
    const listed = await get(PD_ROUTES.pages);
    if (listed.status !== 200) {
      throw new Error(`pd social: the site has problems, so nothing was written:\n${(await listed.text()).split("\n").filter(Boolean).map(l => `  - ${l}`).join("\n")}`);
    }
    const problems: string[] = [];
    for (const p of (await listed.json() as StorefrontPagesResponse).pages) {
      const res = await get(p.route);
      if (res.status !== 200 && res.status !== 404) problems.push(`${p.route}: ${res.status}`);
    }
    if (problems.length) throw new Error(`pd social: the site has problems, so nothing was written:\n${problems.map(p => `  - ${p}`).join("\n")}`);
    const cards = server.socialCards();
    const cacheDir = socialCacheDir(cfg.cwd);
    const cache = createImageCache(cacheDir, "png");

    // The bytes of every card: committed at its hash already, from the cache, or rendered now.
    const bytes = new Map<string, Buffer>();
    let fromCache = 0;
    let current = 0;
    const toRender = [];
    for (const card of cards) {
      const committed = committedCardFile(dir, card.route, card.hash);
      if (card.file === committed) { current++; continue; }
      const cached = await cache.read(card.hash);
      if (cached) { bytes.set(card.hash, cached); fromCache++; continue; }
      toRender.push(card);
    }
    let rendered = 0;
    if (toRender.length) {
      browser = await launchChromium(playwright, "pd social", CARD_CHROMIUM_ARGS).catch((e: unknown) => {
        if (e instanceof BrowserUnavailableError) throw new Error(e.message);
        throw e;
      });
      const made = await renderCards(toRender, { browser, get });
      if (made.problems.length) {
        throw new Error(`pd social: the site's social images have problems, so nothing was written:\n${made.problems.map(p => `  - ${p}`).join("\n")}`);
      }
      for (const [hash, png] of made.images) { bytes.set(hash, png); await cache.write(hash, png); }
      rendered = toRender.length;
    }

    // Write what is missing, then remove every other card file and the folders left empty.
    const keep = new Set(cards.map(c => committedCardFile(dir, c.route, c.hash)));
    for (const card of cards) {
      const file = committedCardFile(dir, card.route, card.hash);
      const png = bytes.get(card.hash);
      if (!png) continue;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, png);
    }
    let removed = 0;
    const present = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
    for (const rel of present.map(String)) {
      const file = join(dir, rel);
      if (!CARD_FILE.test(rel.split(sep).at(-1)!) || keep.has(file)) continue;
      await rm(file, { force: true });
      removed++;
    }
    await removeEmptyFolders(dir);
    opts.log?.(`${cards.length} social images in ${relative(cfg.cwd, dir) || "."}${sep}: ${rendered} rendered, ${fromCache} from the cache, `
      + `${current} already there${removed ? `; ${removed} old one${removed === 1 ? "" : "s"} removed` : ""}`);
    return { dir, cards: cards.length, rendered, fromCache, current, removed };
  } finally {
    await browser?.close();
    await server.close();
  }
}

/** Remove the folders under `dir` that hold nothing, deepest first; `dir` itself stays. */
async function removeEmptyFolders(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = join(dir, e.name);
    await removeEmptyFolders(sub);
    if ((await readdir(sub)).length === 0) await rmdir(sub);
  }
}
