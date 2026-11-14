// `pd build --browser` (step 6c): the storefront's site pages in Chromium, after the default gates and before anything
// is written, served straight from the build's own server (nothing on disk yet, no port of its own). Two viewports,
// 1000×720 at 1x and 390×844 at 2x. On each page:
//
//   - axe with the rules that need a rendered page (@pattern-dump/a11y's browser tier: contrast, one main landmark,
//     one h1 and the rest jsdom can't decide), severities as in the default gate: a critical or serious WCAG finding
//     is an error (contrast among them), the rest warnings;
//   - every image with variants (`img[srcset]`), brought into view so a lazy one loads, against its rendered box:
//     too large when a smaller variant would have covered the box × the pixel ratio, too small when it doesn't cover
//     it and a larger variant exists. Warnings: they depend on the layout.
//
// Playwright is the project's own (`npm install --save-dev playwright`); Pattern Dump does not depend on it. Without
// it, or without its Chromium, the build stops with a named error before anything is built.
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { axeScript, pageRuleTiers, severityOf } from "@pattern-dump/a11y";

/** The part of Playwright this uses. */
export interface PlaywrightModule {
  chromium: { launch(options?: { headless?: boolean }): Promise<PwBrowser> };
}
interface PwBrowser { newContext(o: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<PwContext>; close(): Promise<void> }
interface PwContext {
  route(url: string, handler: (route: PwRoute) => Promise<void>): Promise<void>;
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}
interface PwRoute { request(): { url(): string }; fulfill(o: { status: number; headers?: Record<string, string>; body: Buffer }): Promise<void>; abort(): Promise<void> }
interface PwPage {
  goto(url: string, o?: { waitUntil?: "load" }): Promise<unknown>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

/** Playwright couldn't be loaded, or its Chromium launched: what to install. */
export class BrowserUnavailableError extends Error {}

const INSTALL = "npm install --save-dev playwright, then npx playwright install chromium";

/** The project's Playwright: `playwright`, else `@playwright/test`, resolved from the project's root. */
export async function loadProjectPlaywright(root: string): Promise<PlaywrightModule> {
  const require = createRequire(join(root, "package.json"));
  for (const name of ["playwright", "@playwright/test"]) {
    let resolved: string;
    try { resolved = require.resolve(name); } catch { continue; }
    const mod = await import(pathToFileURL(resolved).href) as Partial<PlaywrightModule> & { default?: Partial<PlaywrightModule> };
    const chromium = mod.chromium ?? mod.default?.chromium;
    if (chromium) return { chromium };
  }
  throw new BrowserUnavailableError(`pd build --browser needs Playwright in this project: ${INSTALL}`);
}

export const VIEWPORTS = [
  { name: "1000×720", viewport: { width: 1000, height: 720 }, dpr: 1 },
  { name: "390×844", viewport: { width: 390, height: 844 }, dpr: 2 },
] as const;

export interface BrowserCheckResult {
  /** Stop the build: one line per finding, with the page and the viewports it was found at. */
  errors: string[];
  /** Accessibility warnings, one line per finding. */
  a11yWarnings: string[];
  /** Image size warnings, one line per image. */
  images: string[];
}

interface AxeViolation { id: string; impact?: string | null; tags: string[]; help: string; helpUrl: string; nodes: Array<{ target: unknown[] }> }
interface ImageSeen { src: string; sizes: string; box: number; chosen: number | null; candidates: number[] }

/** The browser checks over `pages`, each fetched through `get` (the build's server, as the crawl fetches it). */
export async function runBrowserChecks(o: {
  pages: readonly string[];
  get: (url: string) => Promise<Response>;
  playwright: PlaywrightModule;
}): Promise<BrowserCheckResult> {
  let browser: PwBrowser;
  try {
    browser = await o.playwright.chromium.launch({ headless: true });
  } catch (e) {
    throw new BrowserUnavailableError(`pd build --browser couldn't start Chromium (${(e instanceof Error ? e.message : String(e)).split("\n")[0]}): ${INSTALL}`);
  }
  const origin = "http://site.invalid";
  const axe = axeScript();
  // Keyed by what was found, with the viewports it was found at.
  const found = new Map<string, { kind: "error" | "a11y" | "image"; text: string; at: string[] }>();
  const note = (kind: "error" | "a11y" | "image", key: string, text: string, at: string) => {
    const f = found.get(key) ?? { kind, text, at: [] };
    f.at.push(at);
    found.set(key, f);
  };
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: vp.dpr });
      // The site from the build's server; anything else (another host) is not fetched.
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { await route.abort(); return; }
        const res = await o.get(`${url.pathname}${url.search}`);
        const headers: Record<string, string> = {};
        const type = res.headers.get("content-type");
        if (type) headers["content-type"] = type;
        await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
      });
      const page = await context.newPage();
      for (const path of o.pages) {
        await page.goto(`${origin}${path}`, { waitUntil: "load" });
        await page.addScriptTag({ content: axe });
        const violations = await page.evaluate(async (rules: string[]) => {
          const r = await (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: unknown[] }> } }).axe
            .run(document, { runOnly: { type: "rule", values: rules }, resultTypes: ["violations"], iframes: false });
          return r.violations;
        }, pageRuleTiers.browser) as AxeViolation[];
        for (const v of violations) {
          const where = v.nodes.map(n => n.target.map(String).join(" ")).join(", ");
          const text = `${path}: ${v.id} (${v.impact ?? "minor"}): ${v.help}, on ${where} (${v.helpUrl})`;
          note(severityOf(v.impact, v.tags) === "error" ? "error" : "a11y", `a11y ${text}`, text, vp.name);
        }
        // Each image with variants, in view (a lazy one loads), then its chosen candidate against its box.
        const images = await page.evaluate(async () => {
          const seen: ImageSeen[] = [];
          for (const img of Array.from(document.querySelectorAll<HTMLImageElement>("img[srcset]"))) {
            img.scrollIntoView({ block: "center", inline: "center" });
            if (!img.complete || img.naturalWidth === 0) {
              await new Promise<void>(resolve => {
                const done = () => resolve();
                img.addEventListener("load", done, { once: true });
                img.addEventListener("error", done, { once: true });
                setTimeout(done, 5000);
              });
            }
            const candidates = img.srcset.split(",").map(c => c.trim().split(/\s+/)).map(([u, d]) => ({ url: new URL(u!, location.href).href, w: parseInt(d ?? "", 10) }));
            const chosen = candidates.find(c => c.url === img.currentSrc);
            seen.push({ src: img.getAttribute("src") ?? "", sizes: img.sizes, box: img.getBoundingClientRect().width,
              chosen: chosen && !Number.isNaN(chosen.w) ? chosen.w : null, candidates: candidates.map(c => c.w).filter(w => !Number.isNaN(w)) });
          }
          return seen;
        }, undefined) as ImageSeen[];
        for (const img of images) {
          if (img.chosen === null || img.box === 0) continue;
          const need = Math.round(img.box * vp.dpr);
          const covering = img.candidates.filter(w => w >= need).sort((a, b) => a - b)[0];
          const src = img.src.replace(/\?v=[0-9a-f]+$/, "");
          // An image with variants is named by its asset (/_pd/images/images/harbour.<key>.<width>.webp → images/harbour).
          const asset = /^\/_pd\/images\/(.+)\.[0-9a-f]{10}\.\d+\.webp$/.exec(src)?.[1];
          const what = asset ? `the image ${asset}` : `<img src="${src}">`;
          const box = `is laid out ${Math.round(img.box)} px wide (${need} px at ${vp.dpr}x)`;
          if (covering !== undefined && img.chosen > covering) {
            note("image", `image ${path} ${src} large`, `${path}: ${what} ${box} but takes the ${img.chosen}w variant `
              + `where ${covering}w would do: its sizes, "${img.sizes}", says it is wider than it is`, vp.name);
          } else if (img.chosen < need && img.candidates.some(w => w > img.chosen!)) {
            note("image", `image ${path} ${src} small`, `${path}: ${what} ${box} but takes the ${img.chosen}w variant, `
              + `which is too small: its sizes, "${img.sizes}", says it is narrower than it is`, vp.name);
          }
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const lines = (kind: string) => [...found.values()].filter(f => f.kind === kind).map(f => `${f.text} (at ${f.at.join(" and ")})`);
  return { errors: lines("error"), a11yWarnings: lines("a11y"), images: lines("image") };
}
