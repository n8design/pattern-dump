// `pd dev`: social images rendered on request (social-route.ts asks), so a page's head and its card can be checked
// before a build. The project's Playwright is loaded once, on the first page that needs a card; Chromium is launched
// on the first card to render and closed with the server. Each hash is rendered once at a time however many requests
// ask for it, into the same cache pd build reads. A card with a problem is not cached: its request answers 500 with
// the problems, and the next request tries again (after the file is fixed, the card has another hash anyway).

import { createImageCache } from "@pattern-dump/build";
import { socialCacheDir } from "./image-route.js";
import type { ResolvedConfig } from "./server-config.js";
import { BrowserUnavailableError, launchChromium, loadProjectPlaywright, type PlaywrightModule, type PwBrowser } from "./storefront/browser-checks.js";
import { hostTransport } from "./storefront/crawl.js";
import type { SocialCard } from "./storefront/social-images.js";
import { CARD_CHROMIUM_ARGS, renderCards } from "./storefront/social-render.js";

export interface DevCardRenderer {
  /** Undefined when a card can be rendered; else why not, in the words of each page's warning. */
  unavailable(): Promise<string | undefined>;
  /** The card's PNG, rendered now (or by a request already rendering it), or its problems. */
  render(card: SocialCard): Promise<{ png: Buffer } | { problems: string[] }>;
  close(): Promise<void>;
}

export function createDevCardRenderer(cfg: ResolvedConfig, port: () => number,
  load: (root: string) => Promise<PlaywrightModule> = r => loadProjectPlaywright(r, "pd dev")): DevCardRenderer {
  let playwright: Promise<PlaywrightModule | undefined> | undefined;
  let browser: Promise<PwBrowser> | undefined;
  const inFlight = new Map<string, Promise<{ png: Buffer } | { problems: string[] }>>();
  const cache = createImageCache(socialCacheDir(cfg.cwd), "png");
  const loaded = () => playwright ??= load(cfg.cwd).catch((e: unknown) => {
    if (e instanceof BrowserUnavailableError) return undefined;
    throw e;
  });
  return {
    async unavailable() {
      return await loaded() ? undefined : "Playwright isn't installed: run pd social, or install Playwright";
    },
    render(card) {
      let run = inFlight.get(card.hash);
      if (!run) {
        run = (async () => {
          const pw = await loaded();
          if (!pw) return { problems: ["Playwright isn't installed: run pd social, or install Playwright"] };
          browser ??= launchChromium(pw, "pd dev", CARD_CHROMIUM_ARGS);
          const b = await browser.catch((e: unknown) => { browser = undefined; throw e; });
          const site = cfg.storefront!;
          const made = await renderCards([card], { browser: b, get: hostTransport(port(), site.host, site.basePath) });
          const png = made.images.get(card.hash);
          if (!png) return { problems: made.problems };
          await cache.write(card.hash, png);
          return { png };
        })().finally(() => inFlight.delete(card.hash));
        inFlight.set(card.hash, run);
      }
      return run;
    },
    async close() {
      const b = await browser?.catch(() => undefined);
      await b?.close();
    },
  };
}
