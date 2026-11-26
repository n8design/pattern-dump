// pd build with build.workbench: false: a content-only site whose workbench another build publishes (its style
// guide's). The storefront is written and checked as always; the workbench, its output folder and its base path are
// not this build's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig, type SiteConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
// A fixed clock, after every date the bench's pages carry: the build's day decides which pages are scheduled.
const NOW = new Date("2027-01-02T03:04:05.000Z");
let tmp = "";

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-no-workbench-")); });
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
const exists = (p: string) => stat(p).then(() => true, () => false);

const noWorkbench = (over: Partial<PatternDumpConfig> = {}): PatternDumpConfig => validateConfig({
  ...benchConfig, build: { workbench: false }, site: { ...benchConfig.site!, workbenchUrl: "/workbench/" }, ...over,
}, "test");

describe("pd build — build.workbench: false", () => {
  it("writes the storefront only, leaves the workbench folder alone, and asks for no base path", async () => {
    const root = await benchCopy();
    const out = join(root, "..", "nowb-out");
    await save(join(out, "kept.txt"), "an earlier build's file\n");
    // A same-host workbenchUrl and no base path: with a workbench this build would refuse (it would be built for /).
    const report = await build(root, out, noWorkbench());
    expect(report.workbench).toBe(false);
    expect(report.files).toBe(0);
    expect(report.storefront?.pages).toBeGreaterThan(0);
    expect(await readFile(join(out, "kept.txt"), "utf8")).toBe("an earlier build's file\n");
    expect(await exists(join(out, "index.html"))).toBe(false);
    const site = join(root, ".out", "site");
    expect(await exists(join(site, "index.html"))).toBe(true);
    // The pages still link into the workbench at its address, and its previews stay out of search engines.
    expect(await readFile(join(site, "robots.txt"), "utf8")).toContain("Disallow: /workbench/preview/\n");
    expect(report.notes.some(n => n.startsWith("robots.txt is written to the workbench's root"))).toBe(false);
  }, 60_000);

  it("refuses a project without a storefront: there is nothing to build", async () => {
    const root = await benchCopy();
    const { site: _, ...rest } = benchConfig;
    const cfg = validateConfig({ ...rest, build: { workbench: false } }, "test");
    await expect(build(root, join(root, "..", "nowb-none"), cfg))
      .rejects.toThrow("pd build: build.workbench is false and the project has no site, so there is nothing to build");
  }, 60_000);
});

describe("pd build without site.workbenchUrl", () => {
  const { workbenchUrl: _, ...siteWithout } = benchConfig.site!;
  const without = (workbench: boolean): PatternDumpConfig =>
    validateConfig({ ...benchConfig, build: { workbench }, site: siteWithout }, "test");
  // The bench's one link into the workbench (pages/guides/setup.md), taken out for a site that links none.
  const unlink = async (root: string) => {
    const page = join(root, "pages", "guides", "setup.md");
    const text = await readFile(page, "utf8");
    expect(text).toContain("[callout](pattern:components/callout)");
    await save(page, text.replace("[callout](pattern:components/callout)", "callout"));
  };

  it("builds a site that builds no workbench and links to none: no workbench in robots.txt, examples without a workbench link", async () => {
    const root = await benchCopy();
    await unlink(root);
    const report = await build(root, join(root, "..", "nowb-nourl"), without(false));
    expect(report.workbench).toBe(false);
    const site = join(root, ".out", "site");
    expect(await readFile(join(site, "robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /preview/\n\nSitemap: https://bench.example.test/sitemap.xml\n");
    // An example is the site's own preview, and its caption names the component without a link into a workbench.
    const home = await readFile(join(site, "index.html"), "utf8");
    expect(home).toContain('<iframe src="/preview/components/callout"');
    expect(home).toContain('<figcaption><span class="doc-example-id">components/callout</span></figcaption>');
    expect(home).not.toContain("in the workbench");
    // The build's own server is never an address in the site.
    for (const page of ["index.html", "guides/setup/index.html"]) expect(await readFile(join(site, page), "utf8")).not.toContain("pd.localhost");
  }, 60_000);

  it("stops on a link into the workbench, naming it", async () => {
    const root = await benchCopy();
    await expect(build(root, join(root, "..", "nowb-link"), without(false))).rejects.toThrow(
      "pattern:components/callout: a link into the workbench, and the site has no site.workbenchUrl: set it to the address "
        + "the workbench is published at, or link to the component another way");
  }, 60_000);

  it("still needs it when the workbench is built", async () => {
    const root = await benchCopy();
    await unlink(root);
    await expect(build(root, join(root, "..", "wb-nourl"), without(true))).rejects.toThrow(
      "pd build: site.workbenchUrl is required to build the site: its pages link into the workbench at that address");
  }, 60_000);
});
