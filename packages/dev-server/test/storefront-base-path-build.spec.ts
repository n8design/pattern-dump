// pd build for a site published under a path (storefront.url "https://bench.example.test/sub/"): the same files as at
// the root, written by site path into storefront.outDir (the folder served at the path), every root-relative
// reference in them under the path, the sitemap and canonical URLs with it, no robots.txt (and a note saying what the
// host's own needs), and a link written with the path already fails the build with a hint.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = new Date("2026-01-02T03:04:05.000Z");
let tmp = "";

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-base-")); });
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
const config = (url: string): PatternDumpConfig =>
  validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, url } }, "test");
const build = (root: string, cfg: PatternDumpConfig) =>
  buildStaticSite(cfg, root, { outDir: join(root, "..", `wb-${n++}`), pdVersion: "0.0.0-test", now: NOW });

async function files(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!f.isFile()) continue;
    const path = join(f.parentPath, f.name);
    out.set(relative(dir, path), /\.(?:html|css|xml|txt)$/.test(f.name) ? await readFile(path, "utf8") : "");
  }
  return out;
}

/** Every root-relative URL a built document or stylesheet makes: href, src, srcset, a refresh's url=, url(). */
const rootRelative = (text: string): string[] => [
  ...[...text.matchAll(/\s(?:href|src|poster|action)="(\/[^"]*)"/g)].map(m => m[1]!),
  ...[...text.matchAll(/\ssrcset="([^"]+)"/g)].flatMap(m => m[1]!.split(",").map(c => c.trim().split(/\s+/)[0]!)),
  ...[...text.matchAll(/content="\d+; url=(\/[^"]*)"/g)].map(m => m[1]!),
  ...[...text.matchAll(/url\(\s*['"]?(\/[^'")\s]*)/g)].map(m => m[1]!),
].filter(u => !u.startsWith("//"));

describe("pd build — a storefront under a path", () => {
  let atRoot: Map<string, string>;
  let underPath: Map<string, string>;
  let report: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    const [a, b] = [await benchCopy(), await benchCopy()];
    await build(a, config("https://bench.example.test/"));
    report = await build(b, config("https://bench.example.test/sub/"));
    [atRoot, underPath] = await Promise.all([files(join(a, ".out", "storefront")), files(join(b, ".out", "storefront"))]);
  }, 180_000);

  it("writes the same files as at the root, by site path, but robots.txt", () => {
    expect([...underPath.keys()].sort()).toEqual([...atRoot.keys()].filter(f => f !== "robots.txt").sort());
    expect(underPath.has("index.html") && underPath.has("about/index.html") && underPath.has("_pd/base.css")).toBe(true);
    expect(report.storefront?.basePath).toBe("/sub/");
  });

  it("puts every root-relative reference in every page, stub, preview and stylesheet under the path", () => {
    let count = 0;
    for (const [file, text] of underPath) {
      if (!/\.(?:html|css)$/.test(file)) continue;
      for (const ref of rootRelative(text)) { count++; expect(ref, `${file}: ${ref}`).toMatch(/^\/sub\//); }
    }
    expect(count).toBeGreaterThan(100);
    // The redirect stub forwards under the path.
    expect(underPath.get("setup/index.html")).toContain(`content="0; url=/sub/guides/setup/"`);
  });

  it("carries the path in the sitemap and in canonical URLs", () => {
    const sitemap = underPath.get("sitemap.xml")!;
    expect(sitemap).toContain("<loc>https://bench.example.test/sub/</loc>");
    expect(sitemap).toContain("<loc>https://bench.example.test/sub/about/</loc>");
    expect(sitemap).not.toMatch(/<loc>https:\/\/bench\.example\.test\/(?!sub\/)/);
    expect(underPath.get("about/index.html")).toContain(`<link rel="canonical" href="https://bench.example.test/sub/about/">`);
  });

  it("says what the host's own robots.txt needs", () => {
    expect(report.notes).toContain("robots.txt is not written: the site is published under /sub/, and crawlers read robots.txt only at a "
      + "host's root. Where you can, add to the host's own robots.txt: Disallow: /sub/preview/; Sitemap: https://bench.example.test/sub/sitemap.xml");
  });

  it("fails on a link written with the path already, and says how to write it", async () => {
    const root = await benchCopy();
    await save(join(root, "pages", "doubled.md"), "---\ntitle: Doubled\n---\n\nSee [about](/sub/about/).\n");
    await expect(build(root, config("https://bench.example.test/sub/"))).rejects.toThrow(
      `/doubled/: <a href="/sub/sub/about/">: no page or file is built at /sub/about/: the link is written with the site's path /sub/ `
      + "already; write it from the site's root, such as /about/, and the path is put in front of it");
  }, 60_000);
});
