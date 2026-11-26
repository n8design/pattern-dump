// pd build with site mounts (site.mounts), over copies of mounts-bench: the mounted files in the site's output byte for
// byte, the sitemap with and without a mount's pages, each failure named with both paths and nothing written, and the
// site under a base path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { buildStaticSite } from "../src/static-build.js";
import benchConfig from "../../../mounts-bench/site/pattern-dump.config.js";
import { writeImages } from "../../../mounts-bench/make-images.js";
import { save } from "../../../test-support/save.js";

const bench = fileURLToPath(new URL("../../../mounts-bench/", import.meta.url));
const NOW = new Date("2026-11-25T12:00:00.000Z");
let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-mounts-build-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
/** A copy of the bench, with its images drawn; the site's root is its site/ folder. */
async function copy(): Promise<string> {
  const dir = join(tmp, `b${n++}`);
  await cp(bench, dir, { recursive: true, filter: src => !/[/\\](?:\.out|dist|node_modules)$/.test(src) });
  await writeImages(dir);
  return dir;
}
type Site = NonNullable<PatternDumpConfig["storefront"]>;
const config = (over: (site: Site) => Partial<Site> = () => ({})): PatternDumpConfig => {
  const cfg = validateConfig(benchConfig, "test");
  return { ...cfg, storefront: { ...cfg.storefront!, ...over(cfg.storefront!) } };
};
const build = (dir: string, cfg = config()) =>
  buildStaticSite(cfg, join(dir, "site"), { outDir: join(dir, "site", "dist"), pdVersion: "0.0.0-test", now: NOW });

/** Every file under `dir`, by its path from it with "/", and its SHA-256. */
async function hashes(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const p = join(e.parentPath, e.name);
    out.set(relative(dir, p).split(sep).join("/"), createHash("sha256").update(await readFile(p)).digest("hex"));
  }
  return out;
}
/** Each mount's folder in the bench, and where it is published (from the site's root, without the leading "/"). */
const MOUNTS = { tool: "tool/", other: "other/", root: "", "assets-css": "assets/css/" } as const;

describe("a site with four mounts", () => {
  let dir = "", report: Awaited<ReturnType<typeof build>>, out = new Map<string, string>();
  beforeAll(async () => {
    dir = await copy();
    report = await build(dir);
    out = await hashes(join(dir, "site", ".out", "site"));
  }, 120_000);

  it("writes every mounted file at its route, byte for byte", async () => {
    let compared = 0;
    for (const [name, to] of Object.entries(MOUNTS)) {
      for (const [rel, hash] of await hashes(join(dir, name))) {
        expect(out.get(`${to}${rel}`), `${name}/${rel}`).toBe(hash);
        compared++;
      }
    }
    // tool: 7 files with its logo; other: 1; root: 3 with its favicon; assets-css: 1, under /assets/.
    expect(compared).toBe(12);
    for (const path of ["tool/index.html", "tool/style.css", "tool/app.js", "tool/logo.png", "tool/sitemap.xml", "favicon.ico",
      "manifest.webmanifest", "123456/x.css", "other/index.html", "assets/css/x.css"]) expect(out.has(path), path).toBe(true);
  });

  it("writes the site's own files beside them", () => {
    for (const path of ["index.html", "about/index.html", "about-us/index.html", "notes/index.html", "notes/first/index.html",
      "notes/feed.xml", "feed.xml", "sitemap.xml", "robots.txt", "404.html", "llms.txt", ".nojekyll"]) expect(out.has(path), path).toBe(true);
  });

  it("reports each mount's files and size", () => {
    expect(report.mounts?.map(m => [m.to, m.files])).toEqual([["/tool/", 7], ["/other/", 1], ["/", 3], ["/assets/css/", 1]]);
    expect(report.mounts?.every(m => m.bytes > 0)).toBe(true);
  });

  it("lists every .html file of the mount with sitemap: true, an index.html by its folder, and nothing of the others", async () => {
    const sitemap = await readFile(join(dir, "site", ".out", "site", "sitemap.xml"), "utf8");
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    // The site's pages first, then the mount's, sorted.
    expect(urls.map(u => new URL(u!).pathname)).toEqual(["/", "/about/", "/notes/", "/notes/first/", "/tool/", "/tool/guide/", "/tool/guide/page.html"]);
  });
});

describe("the sitemap without a mount's pages", () => {
  it("has no mounted URL when sitemap is left out", async () => {
    const dir = await copy();
    await build(dir, config(s => ({ mounts: s.mounts!.map(({ from, to }) => ({ from, to })) })));
    const sitemap = await readFile(join(dir, "site", ".out", "site", "sitemap.xml"), "utf8");
    expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]!).pathname).sort())
      .toEqual(["/", "/about/", "/notes/", "/notes/first/"]);
  }, 120_000);
});

describe("what stops the build, with both paths named, writing nothing", () => {
  const tail = "remove the file from the mount, or publish the mount at another route";
  const fails = async (change: (dir: string) => Promise<void>, message: string, cfg?: PatternDumpConfig) => {
    const dir = await copy();
    await change(dir);
    await expect(build(dir, cfg)).rejects.toThrow(message);
    expect(existsSync(join(dir, "site", ".out", "site")), "the site's output").toBe(false);
    expect(existsSync(join(dir, "site", "dist")), "the workbench's output").toBe(false);
  };

  it("a file in a page's place", { timeout: 120_000 }, () =>
    fails(d => save(join(d, "root", "about", "index.html"), "x"),
      `site.mounts: ../root/about/index.html would be published at /about/index.html, which is the page /about/: ${tail}`));

  it("a file in an old route's place (redirectFrom)", { timeout: 120_000 }, () =>
    fails(d => save(join(d, "root", "about-us", "index.html"), "x"),
      `site.mounts: ../root/about-us/index.html would be published at /about-us/index.html, which is the page /about-us/: ${tail}`));

  it("a file in a feed's place", { timeout: 120_000 }, () =>
    fails(d => save(join(d, "root", "notes", "feed.xml"), "x"),
      `site.mounts: ../root/notes/feed.xml would be published at /notes/feed.xml, which is notes/index.md's feed: ${tail}`));

  it("a file in the sitemap's place", { timeout: 120_000 }, () =>
    fails(d => save(join(d, "root", "sitemap.xml"), "x"),
      `site.mounts: ../root/sitemap.xml would be published at /sitemap.xml, which is the site's sitemap.xml: ${tail}`));

  it("a file two mounts publish", { timeout: 120_000 }, () =>
    fails(d => save(join(d, "root", "tool", "style.css"), "x"),
      `site.mounts: ../root/tool/style.css would be published at /tool/style.css, which clashes with ../tool/style.css, published at /tool/style.css: ${tail}`));

  it("a file in a project asset's place under /assets/", { timeout: 120_000 }, () =>
    fails(d => save(join(d, "site", "assets", "css", "x.css"), ".project { color: red; }\n"),
      `site.mounts: ../assets-css/x.css would be published at /assets/css/x.css, which is the project asset assets/css/x.css: ${tail}`,
      validateConfig({ ...benchConfig, assets: { strategy: "central", dir: "./assets" } }, "test")));

  it("a missing folder", { timeout: 120_000 }, () =>
    fails(d => rm(join(d, "other"), { recursive: true }),
      "site.mounts: ../other, published at /other/, doesn't exist: build it before the site (the other tool's build runs first), or remove the mount"));

  it("a link out of the mount", { timeout: 120_000 }, () =>
    fails(d => symlink(join(d, "site", "pages", "about.md"), join(d, "tool", "about.md")),
      "site.mounts: ../tool/about.md is a link to pages/about.md, outside ../tool: a mount publishes files, and a link is published as the file it points to, inside the mount; copy the file in, or remove the link"));

  it("a mount inside the site's output", { timeout: 120_000 }, async () => {
    const dir = await copy();
    const cfg = config(s => ({ mounts: [...s.mounts!, { from: "./.out/site/old", to: "/old/" }] }));
    await expect(build(dir, cfg)).rejects.toThrow(/site\.outDir .* overlaps the mounted folder \.\/\.out\/site\/old \(site\.mounts\)/);
  });
});

describe("under a base path", () => {
  it("puts the mounts in the site's folder as at the root, and the sitemap's URLs carry the path", async () => {
    const dir = await copy();
    await build(dir, config(() => ({ url: "https://mounts.example.test/bench/" })));
    const site = join(dir, "site", ".out", "site");
    const out = await hashes(site);
    expect(out.get("tool/index.html")).toBe((await hashes(join(dir, "tool"))).get("index.html"));
    expect(out.get("favicon.ico")).toBe((await hashes(join(dir, "root"))).get("favicon.ico"));
    const sitemap = await readFile(join(site, "sitemap.xml"), "utf8");
    expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => u!.includes("/tool/"))).toEqual([
      "https://mounts.example.test/bench/tool/", "https://mounts.example.test/bench/tool/guide/",
      "https://mounts.example.test/bench/tool/guide/page.html",
    ]);
    // The home page's links to the mounts carry the path, and the link check found the files.
    const home = await readFile(join(site, "index.html"), "utf8");
    expect(home).toContain(`href="/bench/tool/"`);
    expect(home).toContain(`href="/bench/tool/guide/page.html"`);
  }, 120_000);
});
