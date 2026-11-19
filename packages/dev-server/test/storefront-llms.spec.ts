// pd build writes llms.txt for an indexed storefront (the llmstxt.org format): what it leaves out, how to
// turn it off, and its links without storefront.url. The full text is pinned in storefront-build.spec.ts.
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

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-llms-")); });
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

describe("pd build — llms.txt", () => {
  it("leaves drafts, scheduled pages and pages with index: false out of llms.txt", async () => {
    const root = await benchCopy();
    const edit = async (path: string, from: string, to: string) => {
      const file = join(root, "pages", path);
      await save(file, (await readFile(file, "utf8")).replace(from, to));
    };
    await edit("guides/setup.md", "title: Setup\n", "title: Setup\nindex: false\n");
    await edit("articles/harbour.md", "date: 2026-11-01\n", "date: 2026-11-01\ndraft: true\n");
    // After the build's day (NOW): scheduled, so left out.
    await edit("articles/plain.md", "date: 2026-10-02", "date: 2027-03-01");
    await build(root, join(root, "..", "wb-llms-out"));
    const llms = await readFile(join(root, ".out", "storefront", "llms.txt"), "utf8");
    expect(llms).not.toMatch(/\/guides\/setup\/|\/articles\/harbour\/|\/articles\/plain\//);
    // The rest is there.
    expect(llms).toContain("## Guides\n\n- [Guides](https://bench.example.test/guides/): Longer texts about the bench.\n\n");
    expect(llms).toContain("## Articles\n\n- [Articles](https://bench.example.test/articles/): Everything written for the bench, newest first.\n");
    expect(llms).toContain("- [About](https://bench.example.test/about/)");
  }, 60_000);

  it("writes no llms.txt with site.llms: false, or for a site with index: false", async () => {
    const root = await benchCopy();
    await build(root, join(root, "..", "wb-llms-off"), config({ llms: false }));
    expect(await exists(join(root, ".out", "storefront", "llms.txt"))).toBe(false);
    await build(root, join(root, "..", "wb-llms-staging"), config({ index: false }));
    expect(await exists(join(root, ".out", "storefront", "llms.txt"))).toBe(false);
  }, 60_000);

  it("without site.url: llms.txt links each page by its path from the site's root", async () => {
    const root = await benchCopy();
    const { url: _u, ...rest } = benchConfig.site!;
    await buildStaticSite(validateConfig({ ...benchConfig, site: rest }, "test"), root, { outDir: join(root, "..", "wb-llms-nourl"), pdVersion: "x", now: NOW });
    const llms = await readFile(join(root, ".out", "storefront", "llms.txt"), "utf8");
    expect(llms).toContain("- [About](/about/): What the bench is for.\n");
    expect(llms).not.toContain("https://");
  }, 60_000);
});
