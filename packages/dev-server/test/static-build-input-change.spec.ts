// A file saved while pd build runs stops the build, naming the file, before anything is written: the storefront is
// written as the crawl read it and pd build runs no watcher, so this check is what notices. The change is made
// from the Pagefind loader, which the build calls after it has taken its first look at the files.
//
// The check runs again once the workbench is written and once the storefront is. A change noticed there also leaves
// both folders as they were: the build writes into folders of its own beside them and puts them in place only when
// every check has passed. (Until 0.7.0 the workbench folder had been emptied and rewritten by then.) Those changes
// are made from the build's log, at the line it prints after writing each part.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { renameSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
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

/** What an earlier build left in each output folder, written before a build starts: the build must neither empty
 *  nor add to it unless it finishes, and then replaces it whole. */
async function earlierOutputs(root: string): Promise<void> {
  await save(join(root, ".out", "workbench", "index.html"), "<p>the earlier workbench</p>\n");
  await save(join(root, ".out", "storefront", "index.html"), "<p>the earlier site</p>\n");
  await save(join(root, ".out", "storefront", "stale.html"), "<p>only the earlier site had this</p>\n");
}

/** A build of a fresh copy, with `during` run once the build has started. */
async function buildWith(during: (root: string) => Promise<void>, earlier = false) {
  const root = await benchCopy();
  if (earlier) await earlierOutputs(root);
  const out = join(root, ".out", "workbench");
  const result = buildStaticSite(config, root, {
    outDir: out, pdVersion: "0.0.0-test", now: NOW,
    loadPagefind: async () => { await during(root); return undefined; },
  });
  return { root, out, result };
}

/** A build of a fresh copy in which pages/about.md changes at the first log line that contains `atLog`. The log
 *  is synchronous and the build goes on when it returns, so the new text is saved beforehand, outside the project,
 *  and renamed into place there: the change is on disk before the build's next step. */
async function buildChangingAboutAt(atLog: string) {
  const root = await benchCopy();
  await earlierOutputs(root);
  const out = join(root, ".out", "workbench");
  const about = join(root, "pages", "about.md");
  const staged = join(tmp, `about-${n}.md`);
  await save(staged, `${await readFile(about, "utf8")}\nOne more line.\n`);
  let moved = false;
  const result = buildStaticSite(config, root, {
    outDir: out, pdVersion: "0.0.0-test", now: NOW, loadPagefind: async () => undefined,
    log: line => { if (!moved && line.includes(atLog)) { renameSync(staged, about); moved = true; } },
  });
  return { root, out, result };
}

/** Every file under a folder, by its path in it, with its content. */
async function contents(dir: string): Promise<Record<string, string>> {
  const files = await readdir(dir, { recursive: true, withFileTypes: true });
  const out: Record<string, string> = {};
  for (const f of files.filter(e => e.isFile())) {
    const path = join(f.parentPath, f.name);
    out[path.slice(dir.length + 1)] = await readFile(path, "utf8");
  }
  return out;
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
    expect(message).toContain("pd build: the project changed while it was being built, so the build stopped (it said: pd build: the site has problems, so nothing was written)");
    expect(message).toContain("  - pages/about.md (removed)");
    expect(message).toContain("  - src/patterns/components/zz-added.hbs (added)");
  }, 120_000);

  for (const [part, atLog] of [["the workbench", " folder overviews ("], ["the site", "… site: "]] as const) {
    it(`leaves both folders as they were when a file changes after ${part} is written`, async () => {
      const { root, out, result } = await buildChangingAboutAt(atLog);
      const sfOut = join(root, ".out", "storefront");
      await expect(result).rejects.toThrow(/^pd build: the project changed while it was being built, so nothing was written\. Run pd build again once the files are saved:\n  - pages\/about\.md \(changed\)$/);
      expect(await contents(out)).toEqual({ "index.html": "<p>the earlier workbench</p>\n" });
      expect(await contents(sfOut)).toEqual({ "index.html": "<p>the earlier site</p>\n", "stale.html": "<p>only the earlier site had this</p>\n" });
      // Nothing of the build is left beside them.
      expect((await readdir(join(root, ".out"))).sort()).toEqual(["storefront", "workbench"]);
    }, 120_000);
  }

  it("builds as before when nothing changes, replacing what an earlier build wrote", async () => {
    const { root, out, result } = await buildWith(async () => {}, true);
    const report = await result;
    expect(report.storefront?.pages).toBeGreaterThan(0);
    expect(await exists(join(out, "index.html"))).toBe(true);
    expect(await readFile(join(out, "index.html"), "utf8")).not.toContain("the earlier workbench");
    expect(await readFile(join(root, ".out", "storefront", "index.html"), "utf8")).not.toContain("the earlier site");
    expect(await exists(join(root, ".out", "storefront", "stale.html"))).toBe(false);
    expect((await readdir(join(root, ".out"))).sort()).toEqual(["storefront", "workbench"]);
  }, 120_000);
});
