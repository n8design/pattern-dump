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
