// The bench published under a path (storefront.url "https://bench.example.test/sub/"), in pd dev and as built, served
// by a static host under /sub/: read off the rendered pages. The host's root opens the site; links, Back and Forward
// stay under the path; stylesheets apply, images and previews load, an old route forwards; no request leaves the path;
// the page names its path for scripts; and pd dev and pd build give the same DOM there too.
// Its own servers, on free ports: pd dev in this process, the build served by static-server.mjs.
import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { buildStaticSite, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../pattern-dump.config.js";
import { BUILD_WORKBENCH_URL, domWithoutLiveClient } from "./helpers.js";

test.setTimeout(60_000);
const bench = fileURLToPath(new URL("../", import.meta.url));
const staticServer = fileURLToPath(new URL("../../apps/dev-ui/e2e/static-server.mjs", import.meta.url));
const SITE_URL = "https://bench.example.test/sub/";

let tmp = "";
let dev: DevServer;
let host: ChildProcess;
let DEV = "";
let STATIC = "";

test.beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-e2e-base-path-"));
  const config = validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, url: SITE_URL, outDir: join(tmp, "site") } }, "storefront-bench");
  await buildStaticSite(config, bench, { outDir: join(tmp, "workbench"), pdVersion: "0.0.0-test" });
  dev = await startDevServer(config, bench, { port: 0, wsPort: 0, live: true });
  DEV = `http://live.localhost:${dev.port}`;
  host = spawn(process.execPath, [staticServer, "--dir", join(tmp, "site"), "--base", "/sub/", "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] });
  STATIC = await new Promise<string>((resolve, reject) => {
    host.stdout!.on("data", (d: Buffer) => { const m = / at (http:\/\/127\.0\.0\.1:\d+)\//.exec(String(d)); if (m) resolve(m[1]!); });
    host.on("exit", code => reject(new Error(`static-server exited (${code})`)));
  });
});
test.afterAll(async () => {
  host?.kill();
  await dev?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

/** Every request the page makes to `origin` (the site's) outside /sub/. */
function outsideRequests(page: Page, origin: string): string[] {
  const outside: string[] = [];
  page.on("request", r => {
    const url = new URL(r.url());
    if (url.origin === origin && !url.pathname.startsWith("/sub/") && url.pathname !== "/favicon.ico") outside.push(url.pathname);
  });
  return outside;
}

/** The page once each preview frame is fitted. */
async function settled(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect.poll(() => page.locator("iframe").evaluateAll(fs => fs.every(f => {
    const frame = f as HTMLIFrameElement;
    return !!frame.contentDocument?.body?.childElementCount && frame.style.height !== "1px" && frame.style.height !== "";
  }))).toBe(true);
}

for (const where of ["dev", "static"] as const) {
  const at = () => where === "dev" ? DEV : STATIC;

  test.describe(`under /sub/ (${where})`, () => {
    if (where === "dev") {
      test("the host's root opens the site at its path", async ({ page }) => {
        await page.goto(`${DEV}/`);
        await expect(page).toHaveURL(`${DEV}/sub/`);
        await expect(page.locator("h1")).toBeVisible();
      });
    }

    test("stylesheets apply, previews render and size, and the page names its path", async ({ page }) => {
      const outside = outsideRequests(page, at());
      await settled(page, `${at()}/sub/`);
      // The skin's base layer (body margin 0) and the header's own stylesheet (its border).
      expect(await page.evaluate(() => getComputedStyle(document.body).marginTop)).toBe("0px");
      expect(await page.locator(".site-header").evaluate(e => getComputedStyle(e).borderBottomWidth)).toBe("1px");
      expect(await page.locator("iframe").count()).toBeGreaterThan(0);
      await expect(page.locator('meta[name="pd-base-path"]')).toHaveAttribute("content", "/sub/");
      expect(outside).toEqual([]);
    });

    test("images load from their variants under the path", async ({ page }) => {
      const outside = outsideRequests(page, at());
      await page.goto(`${at()}/sub/articles/`);
      const img = page.locator("img[srcset]").first();
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate(i => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect(await img.evaluate(i => new URL((i as HTMLImageElement).currentSrc).pathname)).toMatch(/^\/sub\/_pd\/images\//);
      expect(outside).toEqual([]);
    });

    test("links, Back and Forward stay under the path", async ({ page }) => {
      await page.goto(`${at()}/sub/`);
      await page.locator('a[href="/sub/about/"]').first().click();
      await expect(page).toHaveURL(`${at()}/sub/about/`);
      await page.locator("a.site-title").click();
      await expect(page).toHaveURL(`${at()}/sub/`);
      await page.goBack();
      await expect(page).toHaveURL(`${at()}/sub/about/`);
      await page.goForward();
      await expect(page).toHaveURL(`${at()}/sub/`);
    });

    test("an old route forwards to its page under the path", async ({ page }) => {
      await page.goto(`${at()}/sub/setup/`);
      await expect(page).toHaveURL(`${at()}/sub/guides/setup/`);
      await expect(page.locator("h1")).toBeVisible();
    });
  });
}

test("pd dev and pd build give the same DOM under the path", async ({ page }) => {
  for (const route of ["/sub/", "/sub/about/", "/sub/guides/setup/"]) {
    await settled(page, `${DEV}${route}`);
    const fromDev = (await domWithoutLiveClient(page))
      .replaceAll(`http://pd.localhost:${dev.port}/`, BUILD_WORKBENCH_URL).replaceAll(`${DEV}/sub/`, SITE_URL);
    await settled(page, `${STATIC}${route}`);
    expect(fromDev, route).toBe(await domWithoutLiveClient(page));
  }
});
