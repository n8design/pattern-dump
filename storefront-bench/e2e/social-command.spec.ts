// `pd social` in a real Chromium (social-command.ts): it writes the site's cards into social/ beside the pages folder,
// exactly the ones a build of the same project renders, plus a scheduled page's (ready on its day), never a draft's;
// a build after it renders none, its cards coming from the folder; a card whose inputs change is stale, and the next
// pd social replaces it; a page that no longer gets a card loses its file; one card with a problem and nothing is
// written or removed. The project is social-fixture.ts's.
import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { buildStaticSite, renderSocialImages } from "@pattern-dump/dev-server";
import { save } from "../../test-support/save.js";
import { config, fm, project as projectIn } from "./social-fixture.js";
import { defineConfig, validateConfig } from "@pattern-dump/config";

test.setTimeout(180_000);

let tmp = "";
test.beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-social-command-")); });
test.afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });
const project = (files: Record<string, string | Buffer | null> = {}) => projectIn(tmp, files);

const loadPlaywright = async () => ({ chromium });
const social = (root: string, c = config) => renderSocialImages(c, root, { pdVersion: "0.0.0-test", loadPlaywright: loadPlaywright as never });
const build = (root: string) => buildStaticSite(config, root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test", loadPlaywright: loadPlaywright as never });
const cacheOf = (root: string) => join(root, "node_modules", ".cache", "pattern-dump", "social");
/** The card files under `dir`, by their path from it with "/", sorted. */
const cardsIn = async (dir: string) => (await readdir(dir, { recursive: true }).catch(() => [] as string[])).map(String)
  .filter(f => /(?:^|[\\/])card\.[0-9a-f]{10}\.png$/.test(f)).map(f => f.split(sep).join("/")).sort();
/** Everything under `dir`, files and folders. */
const allIn = async (dir: string) => (await readdir(dir, { recursive: true }).catch(() => [] as string[])).map(f => String(f).split(sep).join("/")).sort();

test("pd social writes the cards a build renders, plus a scheduled page's, never a draft's", async () => {
  const root = await project({
    "pages/guide/later.md": fm(["title: Later", "date: 2099-01-01"]),
    "pages/guide/wip.md": fm(["title: Work in progress", "draft: true"]),
  });
  await build(root);
  const built = await cardsIn(join(root, ".out", "site", "_pd", "social"));
  expect(built).toHaveLength(3);
  await rm(cacheOf(root), { recursive: true, force: true });
  const report = await social(root);
  const written = await cardsIn(join(root, "social"));
  expect(written.filter(f => !f.startsWith("guide/later/"))).toEqual(built);
  expect(written.filter(f => f.startsWith("guide/later/"))).toHaveLength(1);
  expect(written.some(f => f.startsWith("guide/wip/"))).toBe(false);
  expect(report).toMatchObject({ cards: 4, rendered: 4, fromCache: 0, current: 0, removed: 0 });
});

test("a build after pd social renders none: its cards come from the folder", async () => {
  const root = await project();
  await social(root);
  await rm(cacheOf(root), { recursive: true, force: true });
  const report = await build(root);
  expect(report.socialImages).toEqual({ pages: 3, rendered: 0, cached: 0, committed: 3 });
  expect(await cardsIn(join(root, ".out", "site", "_pd", "social"))).toEqual(await cardsIn(join(root, "social")));
});

test("a title edit makes its card stale: a build renders it, the next pd social replaces the old file", async () => {
  const root = await project();
  await social(root);
  const before = await cardsIn(join(root, "social"));
  await save(join(root, "pages", "guide", "install.md"), fm(["title: Installing"]));
  await rm(cacheOf(root), { recursive: true, force: true });
  expect((await build(root)).socialImages).toEqual({ pages: 3, rendered: 1, cached: 0, committed: 2 });
  const report = await social(root);
  expect(report).toMatchObject({ cards: 3, rendered: 0, fromCache: 1, current: 2, removed: 1 });
  const after = await cardsIn(join(root, "social"));
  expect(after.filter(f => f.startsWith("guide/install/"))).toHaveLength(1);
  expect(after.filter(f => !f.startsWith("guide/install/"))).toEqual(before.filter(f => !f.startsWith("guide/install/")));
  expect(after.find(f => f.startsWith("guide/install/"))).not.toBe(before.find(f => f.startsWith("guide/install/")));
});

test("a page that now sets image loses its card, and its folder goes with it", async () => {
  const root = await project();
  await social(root);
  expect((await cardsIn(join(root, "social"))).some(f => f.startsWith("guide/install/"))).toBe(true);
  await save(join(root, "pages", "guide", "install.md"), fm(["title: Install", "image: /assets/share.png"]));
  const report = await social(root);
  expect(report).toMatchObject({ cards: 2, removed: 1 });
  expect((await allIn(join(root, "social"))).some(f => f.startsWith("guide/install"))).toBe(false);
});

test("one card with a problem: nothing is written or removed", async () => {
  const root = await project();
  await social(root);
  const before = await allIn(join(root, "social"));
  await save(join(root, "pages", "guide", "install.md"), fm([`title: ${"A title far too long for any card ".repeat(4).trim()}`]));
  await save(join(root, "pages", "about.md"), fm(["title: About"]));
  const message = await social(root).then(() => "written", (e: Error) => e.message);
  expect(message).toContain("pd social: the site's social images have problems, so nothing was written:\n");
  expect(message).toContain("  - guide/install.md: the social image cuts its title off: shorten it, or let the component take more lines");
  expect(await allIn(join(root, "social"))).toEqual(before);
});

test("without site.socialImages, or without Playwright in the project, it says what to do", async () => {
  const root = await project();
  const off = validateConfig(defineConfig({ sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./.out/wb",
    site: { pagesDir: "./pages", outDir: "./.out/site", workbenchUrl: "https://wb.test/" } } as never), "test");
  expect(await social(root, off).then(() => "written", (e: Error) => e.message))
    .toBe("pd social: site.socialImages is not set, so there are no social images to render: set site.socialImages.component");
  // The project's own Playwright: a project in a temporary folder has none.
  expect(await renderSocialImages(config, root, { pdVersion: "0.0.0-test" }).then(() => "written", (e: Error) => e.message))
    .toBe("pd social needs Playwright in this project: npm install --save-dev playwright, then npx playwright install chromium");
});
