// Social images rendered (social-images.ts says which and with what): each card's document in Chromium, through the
// project's own Playwright, as `pd build --browser` uses it (browser-checks.ts). The document and everything it loads
// come from the build's server through `get`, from memory, as a page's do: nothing is on disk, there is no port.
//
// One context for every card: 1200 x 630 at 1x, reduced motion. A card is the component's root element (the body's
// first element), screenshotted as PNG once its fonts are loaded; the same input gives the same bytes on one machine
// (across machines Chromium draws text a little differently, which is why committed cards are matched by their hash).
// Checks on each card, every one the page's problem:
//   - its size: the root element is 1200 x 630, as the component's own CSS sets it;
//   - overflow: an element holding a field's text (title, description, section, date) that overflows its box, or lies
//     outside the card, cuts that field off;
//   - contrast: axe's color-contrast rule, an error, said once per variant with the pages it was found on.
// A card with a problem is not returned, so it is never cached: the next build renders it again and fails again.

import { axeScript } from "@pattern-dump/a11y";
import type { PwBrowser, PwContext } from "./browser-checks.js";
import { CARD, SOCIAL_FIELDS, type SocialCard } from "./social-images.js";

/** Chromium's options for cards that look the same on macOS and Linux: no font hinting, no LCD text, sRGB. */
export const CARD_CHROMIUM_ARGS = ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"];

/** Where a card's document is opened: a made-up address, answered from memory. */
const ORIGIN = "http://site.invalid";
const CARD_PATH = "/__pd-social-card";

export interface RenderedCards {
  /** Each card that passed, by hash: its PNG. */
  images: Map<string, Buffer>;
  /** Every problem, one line each. Non-empty: the build stops. */
  problems: string[];
}

interface Probe { width: number; height: number; cut: string[] }
interface AxeViolation { id: string; impact?: string | null; help: string; helpUrl: string; nodes: Array<{ target: unknown[] }> }

/** Render `cards` (each hash once) in `browser`, which stays open. `get` asks the build's server for a site path. */
export async function renderCards(cards: readonly SocialCard[], o: {
  browser: PwBrowser; get: (url: string) => Promise<Response>;
}): Promise<RenderedCards> {
  const images = new Map<string, Buffer>();
  const problems: string[] = [];
  if (!cards.length) return { images, problems };
  const byHash = new Map<string, SocialCard>();
  for (const c of cards) if (!byHash.has(c.hash)) byHash.set(c.hash, c);
  const context: PwContext = await o.browser.newContext({ viewport: { width: CARD.width, height: CARD.height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  let current: SocialCard | undefined;
  /** Contrast, by variant: the finding, and the pages it was found on. */
  const contrast = new Map<string, { text: string; pages: string[] }>();
  try {
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) { await route.abort(); return; }
      if (url.pathname === CARD_PATH) {
        await route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: Buffer.from(current!.document) });
        return;
      }
      const res = await o.get(`${url.pathname}${url.search}`);
      const headers: Record<string, string> = {};
      const type = res.headers.get("content-type");
      if (type) headers["content-type"] = type;
      await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
    });
    const page = await context.newPage();
    const axe = axeScript();
    for (const card of byHash.values()) {
      current = card;
      await page.goto(`${ORIGIN}${CARD_PATH}`, { waitUntil: "load" });
      const fields = Object.fromEntries(SOCIAL_FIELDS.filter(f => f !== "site").map(f => [f, card.values?.[f]])
        .filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
      const probe = await page.evaluate(async (texts: Record<string, string>) => {
        await document.fonts.ready;
        const root = document.body.firstElementChild;
        if (!root) return { width: 0, height: 0, cut: [] };
        const box = root.getBoundingClientRect();
        const cut: string[] = [];
        for (const [field, text] of Object.entries(texts)) {
          // The innermost elements whose text holds the field's.
          const holders = [...root.querySelectorAll<HTMLElement>("*"), root as HTMLElement]
            .filter(el => (el.textContent ?? "").includes(text) && ![...el.children].some(c => (c.textContent ?? "").includes(text)));
          for (const el of holders) {
            const r = el.getBoundingClientRect();
            const over = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
            const outside = r.left < box.left - 0.5 || r.top < box.top - 0.5 || r.right > box.right + 0.5 || r.bottom > box.bottom + 0.5;
            if (over || outside) { cut.push(field); break; }
          }
        }
        return { width: Math.round(box.width), height: Math.round(box.height), cut };
      }, fields) as Probe;
      const own: string[] = [];
      if (probe.width !== CARD.width || probe.height !== CARD.height) {
        own.push(`${card.variant}: the social image is ${probe.width} x ${probe.height}, and a card is ${CARD.width} x ${CARD.height}: set its size in its own CSS`);
      }
      for (const field of probe.cut) {
        own.push(`${card.page}: the social image cuts its ${field} off: shorten it, or let the component take more lines`);
      }
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => {
        const r = await (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: unknown[] }> } }).axe
          .run(document, { runOnly: { type: "rule", values: ["color-contrast"] }, resultTypes: ["violations"], iframes: false });
        return r.violations;
      }, undefined) as AxeViolation[];
      for (const v of violations) {
        const where = v.nodes.map(n => n.target.map(String).join(" ")).join(", ");
        const text = `${card.variant}: the social image fails ${v.id} (${v.impact ?? "minor"}): ${v.help}, on ${where} (${v.helpUrl})`;
        const found = contrast.get(text) ?? { text, pages: [] };
        found.pages.push(card.page);
        contrast.set(text, found);
      }
      if (own.length || violations.length) { problems.push(...own); continue; }
      const rect = await page.evaluate(() => {
        const r = document.body.firstElementChild!.getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY };
      }, undefined) as { x: number; y: number };
      images.set(card.hash, await page.screenshot({
        type: "png", fullPage: true, clip: { x: rect.x, y: rect.y, width: CARD.width, height: CARD.height },
        animations: "disabled", caret: "hide", scale: "css",
      }));
    }
  } finally {
    await context.close();
  }
  // Each contrast finding once, for its variant, with every page it was found on (the card of each page with the same
  // design is a different text, so the same failing element shows on each).
  for (const { text, pages } of contrast.values()) {
    const all = [...new Set(pages)];
    problems.push(`${text}, on ${all.length} page${all.length === 1 ? "" : "s"}: ${all.join(", ")}`);
  }
  return { images, problems };
}
