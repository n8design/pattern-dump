// A file saved while pd build runs stops the build, naming the file, before anything is written: the storefront is
// written as the crawl read it and pd build runs no watcher, so this check is what notices. The change is made
// from the Pagefind loader, which the build calls after it has taken its first look at the files.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = new Date("2027-01-02T03:04:05.000Z");
let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-input-change-")); });
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
const config = validateConfig(benchConfig, "test");
const exists = (p: string) => stat(p).then(() => true, () => false);

/** A build of a fresh copy, with `during` run once the build has started. */
async function buildWith(during: (root: string) => Promise<void>) {
  const root = await benchCopy();
  const out = join(root, ".out", "workbench");
  const result = buildStaticSite(config, root, {
    outDir: out, pdVersion: "0.0.0-test", now: NOW,
    loadPagefind: async () => { await during(root); return undefined; },
  });
  return { root, out, result };
}

describe("pd build: a file changed while it runs", () => {
  it("stops before writing anything, naming a changed page", async () => {
    const { root, out, result } = await buildWith(async r => {
      const about = join(r, "pages", "about.md");
      await save(about, `${await readFile(about, "utf8")}\nOne more line.\n`);
    });
    await expect(result).rejects.toThrow(/^pd build: the project changed while it was being built, so nothing was written\. Run pd build again once the files are saved:\n  - pages\/about\.md \(changed\)$/);
    expect(await exists(out)).toBe(false);
    expect(await exists(join(root, ".out", "storefront"))).toBe(false);
  }, 120_000);

  it("names an added component file and a removed page", async () => {
    const { result } = await buildWith(async r => {
      await save(join(r, "src", "patterns", "components", "zz-added.hbs"), "<p>Added</p>\n");
      await rm(join(r, "pages", "about.md"));
    });
    const message = await result.then(() => "", (e: Error) => e.message);
    // The removed page fails the storefront's checks first; the change is what is reported, with what the build said.
    expect(message).toContain("pd build: the project changed while it was being built, so the build stopped (it said: pd build: the storefront has problems, so nothing was written)");
    expect(message).toContain("  - pages/about.md (removed)");
    expect(message).toContain("  - src/patterns/components/zz-added.hbs (added)");
  }, 120_000);

  it("builds as before when nothing changes", async () => {
    const { out, result } = await buildWith(async () => {});
    const report = await result;
    expect(report.storefront?.pages).toBeGreaterThan(0);
    expect(await exists(join(out, "index.html"))).toBe(true);
  }, 120_000);
});
