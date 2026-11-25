// `pd dev` renders social images on request (social-dev.ts, social-route.ts): a page's head names its card, and the
// card's URL answers a PNG, the same file pd build writes for that page; a title saved in the open page gives it a new
// card; a draft, which pd dev shows, gets one too; each card is rendered once however often it is asked for; without
// Playwright the page keeps the site's image and the terminal says so once. The project is social-fixture.ts's, its
// server started here (live, on free ports: free-ports.ts) with the repository's Playwright passed in.
import { test, expect, chromium, type Browser as PwBrowser } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { BrowserUnavailableError, buildStaticSite, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { freePort } from "../../packages/dev-server/test/free-ports.js";
import { save } from "../../test-support/save.js";
import { config, fm, pngSize, project as projectIn } from "./social-fixture.js";

test.setTimeout(180_000);

let tmp = "";
test.beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-social-dev-")); });
test.afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });
const project = (files: Record<string, string | Buffer | null> = {}) => projectIn(tmp, files);

/** The repository's Playwright, with each card render counted (one browser context per render). */
function counting() {
  const count = { renders: 0 };
  const loadPlaywright = async () => ({ chromium: { launch: async (o?: Parameters<typeof chromium.launch>[0]) => {
    const browser: PwBrowser = await chromium.launch(o);
    return { newContext: (c: Parameters<PwBrowser["newContext"]>[0]) => { count.renders++; return browser.newContext(c); }, close: () => browser.close() };
  } } });
  return { count, loadPlaywright };
}
const noPlaywright = async () => { throw new BrowserUnavailableError("pd dev needs Playwright in this project"); };

async function dev(root: string, loadPlaywright: () => Promise<unknown>): Promise<{ server: DevServer; origin: string }> {
  // A real live-reload port: the open page connects to it (port 0 would reach the page as 0). A port taken between
  // finding and binding it is tried again on a fresh one, as free-ports.ts does; started from this file's import, so
  // the BrowserUnavailableError the spec throws is the class the server checks.
  let server: DevServer | undefined;
  for (let attempt = 1; !server; attempt++) {
    try {
      server = await startDevServer(config, root, { port: 0, wsPort: await freePort(), live: true, version: "1.2.3", loadPlaywright: loadPlaywright as never });
    } catch (e) {
      if (!(e instanceof Error && e.name === "PortInUseError") || attempt >= 5) throw e;
    }
  }
  return { server, origin: `http://live.localhost:${server.port}` };
}
/** The path of a page's og:image: in pd dev its address is the one the page was asked on, not site.url. */
/** A GET on a socket of its own (agent: false), so requests sent together are served together. */
const rawGet = (port: number, path: string) => new Promise<number>((resolve, reject) => {
  httpRequest({ host: "127.0.0.1", port, path, agent: false, headers: { host: `live.localhost:${port}` } }, res => {
    res.resume();
    res.on("end", () => resolve(res.statusCode ?? 0));
  }).on("error", reject).end();
});
const og = (html: string) => /<meta property="og:image" content="https?:\/\/[^/"]+(\/[^"]+)">/.exec(html)?.[1];

test("the head names a card; its URL answers the PNG, and pd build writes that same file", async ({ request }) => {
  const root = await project();
  const { count, loadPlaywright } = counting();
  const { server, origin } = await dev(root, loadPlaywright);
  let path: string | undefined;
  try {
    path = og(await (await request.get(`${origin}/guide/install/`)).text());
    expect(path).toMatch(/^\/_pd\/social\/guide\/install\/card\.[0-9a-f]{10}\.png$/);
    const card = await request.get(`${origin}${path}`);
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    expect(pngSize(Buffer.from(await card.body()))).toEqual({ width: 1200, height: 630 });
    expect(count.renders).toBe(1);
  } finally { await server.close(); }
  // The same version, the same hash: the build finds the card dev rendered, and writes it at the URL dev named.
  const report = await buildStaticSite(config, root, { outDir: join(root, ".out", "wb"), pdVersion: "1.2.3", loadPlaywright: (async () => ({ chromium })) as never });
  expect(report.socialImages?.cached).toBeGreaterThanOrEqual(1);
  expect(existsSync(join(root, ".out", "site", ...path!.split("/").filter(Boolean)))).toBe(true);
});

test("each card is rendered once, however often and however many at a time it is asked for", async ({ request }) => {
  const root = await project();
  const { count, loadPlaywright } = counting();
  const { server, origin } = await dev(root, loadPlaywright);
  try {
    const path = og(await (await request.get(`${origin}/guide/`)).text())!;
    const together = await Promise.all(Array.from({ length: 4 }, () => rawGet(server.port, path)));
    expect(together).toEqual([200, 200, 200, 200]);
    expect((await request.get(`${origin}${path}`)).status()).toBe(200);
    expect(count.renders).toBe(1);
  } finally { await server.close(); }
});

test("a title saved in the open page gives it a new card", async ({ page, request }) => {
  const root = await project();
  const { server, origin } = await dev(root, counting().loadPlaywright);
  try {
    await page.goto(`${origin}/guide/install/`);
    const ogOf = () => page.locator(`meta[property="og:image"]`).getAttribute("content");
    const before = await ogOf();
    expect(before).toMatch(/\/_pd\/social\/guide\/install\/card\.[0-9a-f]{10}\.png$/);
    await save(join(root, "pages", "guide", "install.md"), fm(["title: Installing it"]));
    // The page already open reloads, and its head names another card.
    await expect.poll(ogOf, { timeout: 15_000 }).not.toBe(before);
    const after = (await ogOf())!;
    expect(after).toMatch(/\/_pd\/social\/guide\/install\/card\.[0-9a-f]{10}\.png$/);
    expect((await request.get(`${origin}${new URL(after).pathname}`)).status()).toBe(200);
  } finally {
    // The open page holds its connections: closed first, so the server can close.
    await page.close();
    await server.close();
  }
});

test("a draft, shown in pd dev, gets its card on request", async ({ request }) => {
  const root = await project({ "pages/guide/wip.md": fm(["title: Work in progress", "draft: true"]) });
  const { server, origin } = await dev(root, counting().loadPlaywright);
  try {
    const path = og(await (await request.get(`${origin}/guide/wip/`)).text());
    expect(path).toMatch(/^\/_pd\/social\/guide\/wip\/card\.[0-9a-f]{10}\.png$/);
    expect((await request.get(`${origin}${path}`)).status()).toBe(200);
  } finally { await server.close(); }
});

test("without Playwright: the site's image, and the warning once per page", async ({ request }) => {
  const root = await project();
  const printed: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); log(...args); };
  const { server, origin } = await dev(root, noPlaywright);
  try {
    for (let i = 0; i < 2; i++) {
      expect(og(await (await request.get(`${origin}/guide/install/`)).text())).toMatch(/^\/assets\/share\.png\?v=[0-9a-f]{10}$/);
    }
    expect(printed.filter(l => l.includes("no social image"))).toEqual([
      "[site] warning: guide/install.md: no social image: its card is missing or stale and Playwright isn't installed: run pd social, or install Playwright",
    ]);
  } finally { console.log = log; await server.close(); }
});
