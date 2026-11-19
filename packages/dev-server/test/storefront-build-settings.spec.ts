// pd build and the storefront's settings: storefront.workbenchUrl and storefront.url, the sitemap and
// robots.txt, the 404 page, and where the output may go. Split from storefront-build.spec.ts to keep each
// file's burn-in inside its time budget. Built from copies of the bench, with a fixed clock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig, type SiteConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
// A fixed clock, after every date the bench's pages carry: the build's day decides which pages are scheduled.
const NOW = new Date("2027-01-02T03:04:05.000Z");
let tmp = "";

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-settings-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
async function benchCopy(): Promise<string> {
  const root = join(tmp, `bench-${n++}`);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  return root;
}
const config = (over: Partial<SiteConfig> = {}): PatternDumpConfig =>
  validateConfig({ ...benchConfig, site: { ...benchConfig.site!, ...over } }, "test");
const build = (root: string, out: string, cfg: PatternDumpConfig = config()) =>
  buildStaticSite(cfg, root, { outDir: out, pdVersion: "0.0.0-test", now: NOW });

async function tree(dir: string): Promise<Map<string, { bytes: Buffer; mtimeMs: number }>> {
  const out = new Map<string, { bytes: Buffer; mtimeMs: number }>();
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.set(relative(dir, p), { bytes: await readFile(p), mtimeMs: (await stat(p)).mtimeMs });
    }
  };
  await walk(dir);
  return out;
}
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("pd build — the storefront's settings", () => {
  it("needs site.workbenchUrl, and writes nothing without it", async () => {
    const root = await benchCopy();
    const { workbenchUrl: _w, ...rest } = benchConfig.site!;
    const out = join(root, "..", "wb-nourl");
    await expect(buildStaticSite(validateConfig({ ...benchConfig, site: rest }, "test"), root, { outDir: out, pdVersion: "x" }))
      .rejects.toThrow("pd build: site.workbenchUrl is required to build the storefront: its pages link into the workbench at that address");
    expect(await exists(out)).toBe(false);
  });

  it("without site.url: no canonical, Open Graph or card, and one note for the whole build", async () => {
    const root = await benchCopy();
    const { url: _u, ...rest } = benchConfig.site!;
    const report = await buildStaticSite(validateConfig({ ...benchConfig, site: rest }, "test"), root,
      { outDir: join(root, "..", "wb-nosite"), pdVersion: "x", now: NOW });
    const note = `site.url is not set, so pages have no canonical URL, og:url, og:image or JSON-LD, `
      + `and there is no sitemap: set site.url to the site's address, such as "https://example.com/"`;
    expect(report.notes.filter(n => n === note)).toHaveLength(1);
    const pages = await tree(join(root, ".out", "storefront"));
    for (const [file, { bytes }] of pages) {
      if (file.endsWith(".html")) expect(bytes.toString("utf8"), file).not.toMatch(/rel="canonical"|property="og:|name="twitter:/);
    }
  }, 60_000);

  it("fails on an old route that is a page, naming it, and writes nothing", async () => {
    const root = await benchCopy();
    const about = join(root, "pages", "about.md");
    await save(about, (await readFile(about, "utf8")).replace("title: About\n", "title: About\nredirectFrom: /guides/\n"));
    const out = join(root, "..", "wb-redirect-page");
    await expect(build(root, out)).rejects.toThrow(`about.md:4: redirectFrom "/guides/" is the page guides/index.md: a route can't both be a page and forward to one`);
    expect(await exists(out)).toBe(false);
  }, 60_000);

  it("fails on a 404 page with a relative URL, naming it, and writes nothing", async () => {
    const root = await benchCopy();
    await save(join(root, "pages", "404.md"), "---\ntitle: Lost\n---\n\nTry [the guides](./guides/).\n");
    const out = join(root, "..", "wb-rel404");
    await expect(build(root, out)).rejects.toThrow(`the 404 page (404.md): the URL "./guides/" is relative, and the 404 page is served at every address, `
      + `so it only works from the site's root: use "/guides/" instead`);
    expect(await exists(out)).toBe(false);
  }, 60_000);

  it("leaves a page with index: false out of the sitemap", async () => {
    const root = await benchCopy();
    const setup = join(root, "pages", "guides", "setup.md");
    await save(setup, (await readFile(setup, "utf8")).replace("title: Setup\n", "title: Setup\nindex: false\n"));
    await build(root, join(root, "..", "wb-noindex"));
    const out = join(root, ".out", "storefront");
    const sitemap = await readFile(join(out, "sitemap.xml"), "utf8");
    expect(sitemap).not.toContain("/guides/setup/");
    expect(sitemap).toContain("<loc>https://bench.example.test/guides/</loc>");
    expect(await readFile(join(out, "guides", "setup", "index.html"), "utf8")).toContain(`<meta name="robots" content="noindex">`);
  }, 60_000);

  it("a site with index: false: no sitemap, and robots.txt keeps everything out", async () => {
    const root = await benchCopy();
    await build(root, join(root, "..", "wb-staging"), config({ index: false }));
    const out = join(root, ".out", "storefront");
    expect(await exists(join(out, "sitemap.xml"))).toBe(false);
    expect(await readFile(join(out, "robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /\n");
  }, 60_000);

  it("without site.url: no sitemap, and robots.txt names none", async () => {
    const root = await benchCopy();
    const { url: _u, ...rest } = benchConfig.site!;
    await buildStaticSite(validateConfig({ ...benchConfig, site: rest }, "test"), root, { outDir: join(root, "..", "wb-nourl2"), pdVersion: "x", now: NOW });
    const out = join(root, ".out", "storefront");
    expect(await exists(join(out, "sitemap.xml"))).toBe(false);
    expect(await readFile(join(out, "robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /preview/\n");
  }, 60_000);

  it("keeps the storefront's output apart from the workbench's and from what PD reads", async () => {
    const root = await benchCopy();
    await expect(build(root, join(root, ".out", "storefront"))).rejects.toThrow(/and --out .* overlap: the storefront and the workbench each need a folder of their own/);
    await expect(build(root, join(root, "..", "wb-x"), config({ outDir: "./src/styles/out" }))).rejects.toThrow(/site\.outDir .* overlaps .*styles, which Pattern Dump reads/);
    // An output root that contains the project is already refused by the config (it holds the pages and the
    // patterns); the build refuses it too, for a config that never went through validation.
    expect(() => config({ outDir: "." })).toThrow(/"site\.pagesDir" \("\.\/pages"\) is inside "site\.outDir" \("\."\)/);
    // The build reads a config in its validated shape (the site under `storefront`): one with outDir "." set after.
    const valid = config();
    const unvalidated: PatternDumpConfig = { ...valid, storefront: { ...valid.storefront!, outDir: "." } };
    await expect(build(root, join(root, "..", "wb-y"), unvalidated)).rejects.toThrow(/site\.outDir .* would contain the project itself/);
  });
});
