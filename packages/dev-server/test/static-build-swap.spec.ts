// pd build writes each part into a hidden folder beside its output (`.<out>.pd-build-<pid>`) and puts it in place
// only once every check has passed, moving the earlier output aside (`….earlier`) for the moment of the swap.
//
// Leftovers of a build that was killed are cleared when the next one starts: every such folder whose process no
// longer runs, not only this process's. An earlier output that such a build had moved aside and not yet replaced
// is put back. A folder of a build that still runs is left alone.
//
// When the workbench has taken its place and the storefront then can't, the build says the two are out of step,
// and the storefront keeps its earlier output. The rename is made to fail with a mock of node:fs/promises, so this
// spec imports the build from its source, where the mock applies.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "../src/static-build.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

/** The build's own folder can't be renamed onto this path, as a full disk or a permission problem would make it. */
const failing = vi.hoisted(() => ({ renameTo: undefined as string | undefined }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  const rename: typeof fs.rename = async (from, to) => {
    if (failing.renameTo !== undefined && String(to) === failing.renameTo && /\.pd-build-\d+$/.test(String(from))) {
      throw Object.assign(new Error(`EIO: i/o error, rename '${String(from)}' -> '${String(to)}'`), { code: "EIO" });
    }
    return fs.rename(from, to);
  };
  return { ...fs, rename, default: { ...fs, rename } };
});

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = new Date("2027-01-02T03:04:05.000Z");
const config = validateConfig(benchConfig, "test");
const exists = (p: string) => stat(p).then(() => true, () => false);
let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-build-swap-")); });
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

/** The id of a process that has exited. */
const deadPid = (): number => spawnSync(process.execPath, ["-e", ""]).pid!;

describe("pd build: leftovers of a build that was killed", () => {
  it("removes every one whose process no longer runs, puts a moved-aside output back, and keeps a running build's", async () => {
    const root = await benchCopy();
    const out = join(root, ".out", "workbench");
    const sfOut = join(root, ".out", "storefront");
    const dead = deadPid();
    // A killed build that had moved the workbench aside and not yet replaced it, and one that was writing the storefront.
    await save(join(root, ".out", `.workbench.pd-build-${dead}.earlier`, "index.html"), "<p>the earlier workbench</p>\n");
    await save(join(root, ".out", `.storefront.pd-build-${dead}`, "half.html"), "<p>half written</p>\n");
    // A build that still runs (this test's parent process).
    await save(join(root, ".out", `.storefront.pd-build-${process.ppid}`, "busy.html"), "<p>being written</p>\n");
    // Stop this build at its first check, so the outputs show what the clean-up left.
    const result = buildStaticSite(config, root, {
      outDir: out, pdVersion: "0.0.0-test", now: NOW,
      loadPagefind: async () => {
        const about = join(root, "pages", "about.md");
        await save(about, `${await readFile(about, "utf8")}\nOne more line.\n`);
        return undefined;
      },
    });
    await expect(result).rejects.toThrow(/so nothing was written/);
    expect(await readFile(join(out, "index.html"), "utf8")).toBe("<p>the earlier workbench</p>\n");
    expect(await exists(sfOut)).toBe(false);
    expect((await readdir(join(root, ".out"))).sort()).toEqual([`.storefront.pd-build-${process.ppid}`, "workbench"]);
  }, 120_000);
});

describe("pd build: the storefront can't take its place", () => {
  it("says the workbench and the storefront are out of step, and the storefront keeps its earlier output", async () => {
    const root = await benchCopy();
    const out = join(root, ".out", "workbench");
    const sfOut = join(root, ".out", "storefront");
    await save(join(out, "index.html"), "<p>the earlier workbench</p>\n");
    await save(join(sfOut, "index.html"), "<p>the earlier site</p>\n");
    failing.renameTo = sfOut;
    try {
      const result = buildStaticSite(config, root, { outDir: out, pdVersion: "0.0.0-test", now: NOW, loadPagefind: async () => undefined });
      await expect(result).rejects.toThrow(/^pd build: the workbench in .+ is this build's, but the site could not take its place in .+: the two are out of step\. The site in it is the earlier one; run pd build again\.\n {2}EIO: i\/o error/);
    } finally {
      failing.renameTo = undefined;
    }
    expect(await readFile(join(out, "index.html"), "utf8")).not.toContain("the earlier workbench");
    expect(await readFile(join(sfOut, "index.html"), "utf8")).toBe("<p>the earlier site</p>\n");
    expect((await readdir(join(root, ".out"))).sort()).toEqual(["storefront", "workbench"]);
  }, 120_000);
});
