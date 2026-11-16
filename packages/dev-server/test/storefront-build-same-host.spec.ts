// pd build with the workbench published on the storefront's own host: robots.txt keeps its previews out,
// a page can't take its place, and the workbench must be built for its path. Split from
// storefront-build.spec.ts to keep each file's burn-in inside its time budget.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
// A fixed clock, after every date the bench's pages carry: the build's day decides which pages are scheduled.
const NOW = new Date("2027-01-02T03:04:05.000Z");
let tmp = "";

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-same-host-")); });
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
const config = (over: Partial<NonNullable<PatternDumpConfig["storefront"]>> = {}): PatternDumpConfig =>
  validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, ...over } }, "test");
const build = (root: string, out: string, cfg: PatternDumpConfig = config()) =>
  buildStaticSite(cfg, root, { outDir: out, pdVersion: "0.0.0-test", now: NOW });
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("pd build — a workbench on the storefront's host", () => {
  // A workbench published on the storefront's own host (storefront.workbenchUrl a path, or an absolute URL on
  // storefront.url's origin): its previews are kept out by the storefront's robots.txt, at the host's root, so
  // the build no longer asks for its rule to be copied there.
  const sameHostNote = "robots.txt is written to the workbench's root, but crawlers read it only at a host's root: "
    + "with the base path /workbench/, each preview carries a robots noindex tag instead; where you can, also add its rule "
    + "(Disallow: /workbench/preview/) to the robots.txt the host serves at /";
  const buildAt = (root: string, out: string, cfg: PatternDumpConfig) =>
    buildStaticSite(cfg, root, { outDir: out, basePath: "/workbench/", pdVersion: "0.0.0-test", now: NOW });

  it("a workbench at a path on the storefront's host: robots.txt keeps its previews out, and the build asks nothing", async () => {
    const root = await benchCopy();
    const report = await buildAt(root, join(root, "..", "wb-samehost"), config({ workbenchUrl: "/workbench/" }));
    expect(await readFile(join(root, ".out", "storefront", "robots.txt"), "utf8"))
      .toBe("User-agent: *\nDisallow: /preview/\nDisallow: /workbench/preview/\n\nSitemap: https://bench.example.test/sitemap.xml\n");
    expect(report.notes).not.toContain(sameHostNote);
  }, 60_000);

  it("an absolute workbenchUrl on the site's own origin counts as the same host", async () => {
    const root = await benchCopy();
    const report = await buildAt(root, join(root, "..", "wb-sameorigin"), config({ workbenchUrl: "https://bench.example.test/workbench/" }));
    expect(await readFile(join(root, ".out", "storefront", "robots.txt"), "utf8")).toContain("Disallow: /workbench/preview/\n");
    expect(report.notes).not.toContain(sameHostNote);
  }, 60_000);

  it("a workbench on a host of its own: no line for it, and the build still says where its rule must go", async () => {
    const root = await benchCopy();
    const report = await buildAt(root, join(root, "..", "wb-ownhost"), config({ workbenchUrl: "https://workbench.example.test/workbench/" }));
    expect(await readFile(join(root, ".out", "storefront", "robots.txt"), "utf8"))
      .toBe("User-agent: *\nDisallow: /preview/\n\nSitemap: https://bench.example.test/sitemap.xml\n");
    expect(report.notes).toContain(sameHostNote);
  }, 60_000);

  it("fails on a page where the same-host workbench is published, naming it, and writes nothing", async () => {
    const root = await benchCopy();
    await save(join(root, "pages", "workbench.md"), "---\ntitle: Workbench\n---\n\nA page in the workbench's place.\n");
    const out = join(root, "..", "wb-taken");
    await expect(buildAt(root, out, config({ workbenchUrl: "/workbench/" })))
      .rejects.toThrow(`workbench.md: the page /workbench/ is at /workbench/, where the workbench is published on this host (storefront.workbenchUrl), so the workbench would overwrite it there`);
    expect(await exists(out)).toBe(false);
  }, 60_000);

  // A same-host workbench is linked at its path, so the build must make it for that path.
  const builtFor = (got: string) => `pd build: storefront.workbenchUrl is /workbench/, so the workbench must be built for /workbench/ `
    + `(build.basePath or --base); it is being built for ${got}`;
  const withBase = (basePath: string | undefined) => validateConfig({ ...benchConfig, ...(basePath ? { build: { basePath } } : {}),
    storefront: { ...benchConfig.storefront!, workbenchUrl: "/workbench/" } }, "test");

  it("fails when the base path in the config is not the same-host workbench's path, and writes nothing", async () => {
    const root = await benchCopy();
    const out = join(root, "..", "wb-base-config");
    await expect(build(root, out, withBase("/docs/"))).rejects.toThrow(builtFor("/docs/"));
    expect(await exists(out)).toBe(false);
  }, 60_000);

  it("fails when --base overrides a matching build.basePath with another path", async () => {
    const root = await benchCopy();
    const out = join(root, "..", "wb-base-flag");
    await expect(buildStaticSite(withBase("/workbench/"), root, { outDir: out, basePath: "/docs/", pdVersion: "0.0.0-test", now: NOW }))
      .rejects.toThrow(builtFor("/docs/"));
    expect(await exists(out)).toBe(false);
  }, 60_000);

  it("fails when no base path is given at all: the workbench would be built for /", async () => {
    const root = await benchCopy();
    await expect(build(root, join(root, "..", "wb-base-none"), withBase(undefined))).rejects.toThrow(builtFor("/"));
  }, 60_000);

  it("builds when --base names the same-host path in another spelling, and when build.basePath alone gives it", async () => {
    const root = await benchCopy();
    await buildStaticSite(withBase(undefined), root, { outDir: join(root, "..", "wb-base-spelled"), basePath: "/workbench", pdVersion: "0.0.0-test", now: NOW });
    await build(root, join(root, "..", "wb-base-cfg-ok"), withBase("/workbench/"));
  }, 60_000);
});
