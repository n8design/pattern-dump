// usage: node scripts/golden/build.mjs [--repo <checkout>] <commit> <outDir>
//
// A golden build: test-bench AS COMMITTED at <commit>, built by Pattern Dump AS COMMITTED at <commit>, with a fixed
// clock and no working-tree input, so two builds of one commit are byte for byte the same, wherever the checkout is.
//
//   - The checkout (--repo, default: the current directory's repository) must be AT <commit> and clean, so the dist
//     this script builds is that commit's code. Its node_modules is used as it is.
//   - Pattern Dump's own packages are rebuilt first (nx run-many -t build), past Nx's cache, so neither a stale dist
//     nor a cached one built with other dependencies can stand in for this commit's. With the Nx daemon off: a daemon
//     started for a fresh worktree can hang with no output.
//   - test-bench is taken from `git archive <commit> test-bench` into <checkout>/.golden-tb, which must be absent or
//     empty, and every extracted file's mtime is pinned, so `?v=<mtime>` cache-busters don't depend on the checkout.
//   - Pattern packages inside test-bench (pd-fixture-ui) are linked from the archived copy into its own node_modules,
//     which package lookup checks before the repository's (whose link points into the working tree).
//   - Afterwards the script FAILS if a pattern package resolves outside the extraction, or if any file of the
//     snapshot names the checkout, the extraction folder or the temp folder: a build writes no machine path
//     (the path-leak spec checks the same of every build).
//   - Every build has its own empty temp folder, removed afterwards, as TMPDIR and as XDG_CACHE_HOME: Pattern Dump
//     keeps per-project state (the diagnostics graph and its cached audits, scratch.ts) in the user's cache folder,
//     keyed by the project's path, and an earlier build's cached audits must not reach this one.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdir, readdir, readFile, realpath, symlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const CLOCK = new Date("2026-01-02T03:04:05.000Z");
const TOUCH_STAMP = "202601020304.05"; // touch -t, local time: fixed, so identical on every run

const args = process.argv.slice(2);
let repoArg;
if (args[0] === "--repo") { repoArg = args[1]; args.splice(0, 2); }
const [commitArg, outArg] = args;
const fail = msg => { console.error(`golden build: ${msg}`); process.exit(1); };
if (!commitArg || !outArg) fail("usage: node scripts/golden/build.mjs [--repo <checkout>] <commit> <outDir>");
const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repoArg ?? process.cwd(), encoding: "utf8" }).trim();
const repo = realpathSync(top);
const out = resolve(outArg);
const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();

// ---- 0. A temp folder of this build's own, before anything reads TMPDIR ----
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pd-golden-")));
process.env.TMPDIR = scratch;
process.env.XDG_CACHE_HOME = scratch;
process.on("exit", () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* a temp folder: the OS clears it */ } });
if (realpathSync(tmpdir()) !== scratch) fail(`os.tmpdir() is ${tmpdir()}, not this build's temp folder ${scratch}`);

// ---- 1. The checkout is the commit, clean ----
const head = git("rev-parse", "HEAD");
const commit = git("rev-parse", `${commitArg}^{commit}`);
if (head !== commit) fail(`HEAD of ${repo} is ${head.slice(0, 7)}, not ${commit.slice(0, 7)}: check out ${commitArg} first`);
const dirty = git("status", "--porcelain");
if (dirty) fail(`the working tree of ${repo} is not clean:\n${dirty}`);

// ---- 2. Pattern Dump's own code at that commit ----
execFileSync("npx", ["nx", "run-many", "-t", "build", "--skip-nx-cache"], { cwd: repo, stdio: "ignore", env: { ...process.env, NX_DAEMON: "false" } });

// ---- 3. test-bench at that commit, with pinned mtimes ----
// The folder is the same for every build of every commit (<checkout>/.golden-tb), and empty before extraction, so
// nothing from an earlier extraction can leak in. It is removed when the build ends; a crash that leaves it behind
// makes the next run stop here rather than build on top of it.
const tb = join(repo, ".golden-tb");
if (existsSync(tb) && (await readdir(tb)).length > 0) {
  fail(`${tb} is not empty: a previous golden build did not finish. Inspect it, remove it, and run again`);
}
const root = join(tb, "test-bench");
await mkdir(tb, { recursive: true });
process.on("exit", () => { try { rmSync(tb, { recursive: true, force: true }); } catch { /* the next run's emptiness check reports it */ } });
execFileSync("sh", ["-c", `git archive ${commit} test-bench | tar -x -C "${tb}"`], { cwd: repo });

// ---- 4. Pattern packages from the archived copy ----
const { loadConfig } = await import(pathToFileURL(join(repo, "packages/core/dist/index.js")).href);
const config = await loadConfig(root);
for (const ref of config.packages ?? []) {
  const name = typeof ref === "string" ? ref : ref.name;
  const archived = join(root, "packages", name);
  if (!existsSync(join(archived, "package.json"))) fail(`pattern package "${name}" is not inside test-bench/packages: it can't be built from the archive`);
  await mkdir(join(root, "node_modules"), { recursive: true });
  await symlink(join("..", "packages", name), join(root, "node_modules", name));
}
execFileSync("sh", ["-c", `find "${tb}" -exec touch -h -t ${TOUCH_STAMP} {} +`]);

const { buildStaticSite } = await import(pathToFileURL(join(repo, "packages/dev-server/dist/index.js")).href);
for (const ref of config.packages ?? []) {
  const name = typeof ref === "string" ? ref : ref.name;
  // The lookup Pattern Dump uses: node_modules from the root upward. Checked by real path.
  let dir = root, found = null;
  for (;;) { const c = join(dir, "node_modules", name); if (existsSync(join(c, "package.json"))) { found = c; break; } const up = resolve(dir, ".."); if (up === dir) break; dir = up; }
  if (!found) fail(`pattern package "${name}" not found from ${root}`);
  const real = await realpath(found);
  if (!real.startsWith(tb + sep)) fail(`pattern package "${name}" resolves to ${real}, outside the archive`);
}

// ---- 5. Build ----
const report = await buildStaticSite(config, root, { outDir: out, basePath: "/pd/", pdVersion: "golden", now: CLOCK });

// ---- 6. No machine path in the snapshot ----
const needles = [...new Set([repo, top, tb, scratch])];
const leaks = [];
const walk = async d => {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { await walk(p); continue; }
    const text = await readFile(p, "utf8");
    for (const n of needles) if (text.includes(n)) leaks.push(`${p.slice(out.length + 1)}: ${n}`);
  }
};
await walk(out);
if (leaks.length) fail(`the snapshot names a folder of this machine:\n  ${leaks.join("\n  ")}`);

console.log(`golden build @ ${commit.slice(0, 7)}: ${report.files} files written, ${report.warnings.length} warnings, no working-tree input`);
