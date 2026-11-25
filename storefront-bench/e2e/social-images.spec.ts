// Social images rendered in a real Chromium (social-render.ts), before the crawl of `pd build`: a page without an image
// gets a PNG card of 1200 x 630 that its head names and the build writes; the same input gives the same bytes; a card
// already in the cache isn't rendered again, a stale committed one is; a card whose title doesn't fit, whose size isn't
// a card's, or whose text fails contrast stops the build. Playwright here is the repository's, as a project's own would
// be. The project is social-fixture.ts's.
import { test, expect, chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { save } from "../../test-support/save.js";
import { CARD_CSS, config, fm, pngSize, project as projectIn } from "./social-fixture.js";

test.setTimeout(180_000);

let tmp = "";
test.beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-social-render-")); });
test.afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });
const project = (files: Record<string, string | Buffer | null> = {}) => projectIn(tmp, files);

/** Launches, counted. */
function counted() {
  const count = { launched: 0 };
  return { count, loadPlaywright: async () => ({ chromium: { launch: (o?: Parameters<typeof chromium.launch>[0]) => { count.launched++; return chromium.launch(o); } } }) };
}
const build = (root: string, o: { browser?: boolean; loadPlaywright?: () => Promise<unknown> } = {}) =>
  buildStaticSite(config, root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test", ...(o.browser ? { browser: true } : {}),
    loadPlaywright: (o.loadPlaywright ?? (async () => ({ chromium }))) as never });
const failure = (p: Promise<unknown>) => p.then(() => "built", (e: Error) => e.message);
const cacheOf = (root: string) => join(root, "node_modules", ".cache", "pattern-dump", "social");
const ogImage = async (root: string, route: string) =>
  /<meta property="og:image" content="([^"]+)">/.exec(await readFile(join(root, ".out", "site", ...route.split("/").filter(Boolean), "index.html"), "utf8"))?.[1];
/** The card the built page names: its file in the built site. */
async function builtCard(root: string, route: string): Promise<{ hash: string; bytes: Buffer }> {
  const url = await ogImage(root, route);
  const m = /\/_pd\/social\/(.*)card\.([0-9a-f]{10})\.png$/.exec(url ?? "");
  expect(m, `${route}: ${url}`).not.toBeNull();
  return { hash: m![2]!, bytes: await readFile(join(root, ".out", "site", "_pd", "social", ...m![1]!.split("/").filter(Boolean), `card.${m![2]}.png`)) };
}

test("a page without an image gets a card of 1200 x 630, its head names it and the site has it; not a page with its own", async () => {
  const root = await project();
  const report = await build(root);
  const card = await builtCard(root, "/guide/install/");
  expect(card.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(pngSize(card.bytes)).toEqual({ width: 1200, height: 630 });
  expect(await ogImage(root, "/about/")).toMatch(/^https:\/\/example\.test\/assets\/share\.png\?v=/);
  expect(report.socialImages).toEqual({ pages: 3, rendered: 3, cached: 0, committed: 0, missing: [], siteImage: true });
  expect((await readdir(cacheOf(root))).sort()).toHaveLength(3);
});

test("the same input builds the same bytes twice; a second build renders nothing and leaves the cache as it was", async () => {
  const root = await project();
  await build(root);
  const first = await builtCard(root, "/guide/install/");
  const cached = join(cacheOf(root), `${first.hash}.png`);
  const before = (await stat(cached)).mtimeMs;
  const again = await build(root);
  expect(again.socialImages).toEqual({ pages: 3, rendered: 0, cached: 3, committed: 0, missing: [], siteImage: true });
  expect((await stat(cached)).mtimeMs).toBe(before);
  // From an empty cache, rendered again: the same bytes.
  await rm(cacheOf(root), { recursive: true, force: true });
  const fresh = await build(root);
  expect(fresh.socialImages?.rendered).toBe(3);
  expect((await builtCard(root, "/guide/install/")).bytes.equals(first.bytes)).toBe(true);
});

test("a committed card at its hash is used, not rendered; a stale one is rendered into the cache", async () => {
  const root = await project();
  await build(root);
  const { hash, bytes } = await builtCard(root, "/guide/install/");
  await rm(cacheOf(root), { recursive: true, force: true });
  // Committed: this page's at its hash, and another page's with an old one.
  await save(join(root, "social", "guide", "install", `card.${hash}.png`), bytes);
  await save(join(root, "social", "guide", `card.0123456789.png`), bytes);
  const report = await build(root);
  expect(report.socialImages).toEqual({ pages: 3, rendered: 2, cached: 0, committed: 1, missing: [], siteImage: true });
  expect(existsSync(join(cacheOf(root), `${hash}.png`))).toBe(false);
  const guide = await builtCard(root, "/guide/");
  expect(guide.hash).not.toBe("0123456789");
  expect(existsSync(join(cacheOf(root), `${guide.hash}.png`))).toBe(true);
});

test("a title too long for its box stops the build, naming the page and the field; nothing is written or cached", async () => {
  const root = await project({ "pages/guide/install.md": fm([`title: ${"A title far too long for any card ".repeat(4).trim()}`]) });
  const message = await failure(build(root));
  expect(message).toContain("pd build: the site's social images have problems, so nothing was written:\n");
  expect(message).toContain("  - guide/install.md: the social image cuts its title off: shorten it, or let the component take more lines");
  expect(message).not.toContain("guide/index.md");
  expect(existsSync(join(root, ".out"))).toBe(false);
  const cached = await readdir(cacheOf(root)).catch(() => [] as string[]);
  expect(cached).toHaveLength(0);
});

test("a card whose size isn't a card's stops the build", async () => {
  const root = await project({ "src/styles/components/social-image.scss": CARD_CSS.replace("block-size: 630px;", "block-size: 600px;") });
  const message = await failure(build(root));
  expect(message).toContain("  - components/social-image: the social image is 1200 x 600, and a card is 1200 x 630: set its size in its own CSS");
});

test("text that fails contrast stops the build, said once for the variant with its pages", async () => {
  const root = await project({
    // A folder's defaults are its pages', not its own index.md's.
    "pages/guide/index.md": fm(["title: Guide", "childDefaults:", "  socialImage: pale"]),
    "pages/guide/setup.md": fm(["title: Setup"]),
  });
  const message = await failure(build(root));
  const lines = message.split("\n").filter(l => l.includes("color-contrast"));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/^ {2}- components\/social-image~pale: the social image fails color-contrast \(serious\): Elements must meet minimum color contrast ratio thresholds, on .+ \(https:\/\/dequeuniversity\.com\/rules\/axe\/[\d.]+\/color-contrast[^)]*\), on 2 pages: guide\/install\.md, guide\/setup\.md$/);
});

test("with --browser, one Chromium for the cards and the page checks", async () => {
  const root = await project();
  const { count, loadPlaywright } = counted();
  const report = await build(root, { browser: true, loadPlaywright });
  expect(report.socialImages?.rendered).toBe(3);
  expect(report.accessibility?.browser).toBe(true);
  expect(count.launched).toBe(1);
});
