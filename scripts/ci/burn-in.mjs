// Burn-in: run the specs a pull request touches many times, with retries off, so a test that passes
// only now and then fails here instead of on main.
//
//   node scripts/ci/burn-in.mjs --base origin/main            plan from `git diff`, then run it
//   node scripts/ci/burn-in.mjs --plan --files a.spec.ts ...  print the plan for these changed files
//   --runs N      repetitions (default 20)
//   --runner R    only the jobs of this runner, vitest or playwright (to run the halves in different places)
//   --load        run one CPU hog (`stress-ng --cpu 1`) beside the repetitions, as a loaded runner would
//   --matrix      print the jobs split into groups (one CI job each), as one JSON line for a matrix
//   --job JSON    run exactly this one group (an entry of --matrix), not a plan
//
// The mapping from changed files to specs is `planBurnIn` below, and its cases are in burn-in.test.mjs.
// The split into groups is `groupJobs`, by the measured seconds in burn-in-times.json
// (refresh with `node scripts/ci/burn-in-times.mjs <burn-in log>`).
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The Playwright suites: the folder that holds `e2e/` and `playwright.config.ts`. */
const PLAYWRIGHT = ["apps/dev-ui", "storefront-bench", "package-bench", "skins/experimental"];

/**
 * Changes that are not specs but that every spec of a kind stands on. A changed file that matches `when`
 * burns in every spec that matches one of `specs`. Extend this table to cover a new shared piece.
 * Patterns are tested against repo-relative, forward-slash paths.
 */
export const DEPENDENTS = [
  {
    // The watcher harness, the shared save helper, and the server the watcher specs run.
    when: [/^test-support\//, /^packages\/dev-server\/test\/(watch-harness|free-ports)\.ts$/, /^packages\/dev-server\/src\//],
    specs: [
      /^packages\/dev-server\/test\/watcher(-[^/]*)?\.spec\.ts$/,
      /^packages\/dev-server\/test\/reload\.spec\.ts$/,
      /^storefront-bench\/e2e\/hmr\.spec\.ts$/,
    ],
  },
];

const SPEC = /\.(spec|test)\.ts$/;
/** A workspace's folder (the root package.json's workspaces). */
const WORKSPACE = /^((?:packages|apps|skins)\/[^/]+|package-bench|storefront-bench|test-bench)\//;

/**
 * Where a spec runs: Playwright in its suite (its `e2e/` folder); vitest in its workspace, wherever the
 * workspace keeps it (`test/`, or beside the code in `src/`); `node --test` for the repository scripts' own
 * tests (`scripts/**\/*.test.mjs`, run from the repository's root). Null for a file that is no spec.
 */
export function runnerOf(file) {
  if (/^scripts\/.+\.test\.mjs$/.test(file)) return { runner: "node", cwd: "." };
  if (!SPEC.test(file)) return null;
  for (const suite of PLAYWRIGHT) {
    if (file.startsWith(`${suite}/e2e/`)) return { runner: "playwright", cwd: suite };
  }
  const m = WORKSPACE.exec(file);
  if (m) return { runner: "vitest", cwd: m[1] };
  return null;
}

/**
 * The jobs for a pull request.
 * @param {string[]} changed repo-relative paths the pull request changes
 * @param {string[]} allFiles every repo-relative path that exists (specs a rule names are taken from here)
 * @returns {{ runner: "vitest" | "playwright", cwd: string, files: string[] }[]} files are relative to `cwd`
 */
export function planBurnIn(changed, allFiles) {
  const exists = new Set(allFiles);
  const specs = new Set(changed.filter(f => exists.has(f) && runnerOf(f)));
  for (const rule of DEPENDENTS) {
    if (!changed.some(f => rule.when.some(re => re.test(f)))) continue;
    for (const f of allFiles) if (rule.specs.some(re => re.test(f)) && runnerOf(f)) specs.add(f);
  }
  const jobs = new Map();
  for (const file of [...specs].sort()) {
    const { runner, cwd } = runnerOf(file);
    const key = `${runner}:${cwd}`;
    if (!jobs.has(key)) jobs.set(key, { runner, cwd, files: [] });
    jobs.get(key).files.push(posix.relative(cwd, file));
  }
  return [...jobs.values()];
}

/**
 * How many groups (each its own CI job and runner) a workspace's specs are split into. A workspace not
 * listed is one group. More groups cut wall time and add one runner setup each.
 */
export const GROUPS = { "packages/dev-server": 3 };

/** Seconds one run of a spec takes when burn-in-times.json has no measurement for it. */
export const DEFAULT_SECONDS = 2;

/**
 * The least time one run of a group should take before a job is split for it: 15 s is 5 minutes of 20
 * repeats, about what a runner's setup costs. Below it, another group adds more setup than it saves.
 */
export const MIN_GROUP_SECONDS = 15;

/**
 * The jobs split into groups: each job into up to `GROUPS[cwd]` groups of about equal time (no more than
 * one per spec, none under MIN_GROUP_SECONDS), the slowest spec placed first, each into the group with the
 * least time so far.
 * @param {{ runner: string, cwd: string, files: string[] }[]} jobs from planBurnIn
 * @param {Record<string, number>} seconds measured seconds per run, by repo-relative spec path
 * @returns {{ name: string, runner: string, cwd: string, files: string[], seconds: number }[]}
 */
export function groupJobs(jobs, seconds, groups = GROUPS) {
  const out = [];
  for (const job of jobs) {
    const cost = f => seconds[posix.join(job.cwd, f)] ?? DEFAULT_SECONDS;
    const total = job.files.reduce((sum, f) => sum + cost(f), 0);
    const n = Math.max(1, Math.min(groups[job.cwd] ?? 1, job.files.length, Math.floor(total / MIN_GROUP_SECONDS)));
    const bins = Array.from({ length: n }, () => ({ files: [], seconds: 0 }));
    const bySlowest = [...job.files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b));
    for (const f of bySlowest) {
      const bin = bins.reduce((min, b) => (b.seconds < min.seconds ? b : min));
      bin.files.push(f);
      bin.seconds += cost(f);
    }
    bins.forEach((b, i) => out.push({
      // The repository's root (the scripts' tests) is named for what it holds.
      name: `${job.cwd === "." ? "scripts" : job.cwd}${n > 1 ? ` ${i + 1}/${n}` : ""}`,
      runner: job.runner, cwd: job.cwd, files: b.files.sort(), seconds: Math.round(b.seconds * 10) / 10,
    }));
  }
  return out;
}

function readTimes() {
  try { return JSON.parse(readFileSync(join(repo, "scripts/ci/burn-in-times.json"), "utf8")); } catch { return {}; }
}

function git(...args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.split("\n").filter(Boolean);
}

/** The command for one repetition (vitest) or for all of them (Playwright repeats within one run). */
export function commandFor(job, runs) {
  if (job.runner === "node") return { cmd: "node", args: ["--test", ...job.files], times: runs };
  if (job.runner === "vitest") return { cmd: "npx", args: ["vitest", "run", "--retry=0", ...job.files], times: runs };
  return {
    cmd: "npx",
    args: ["playwright", "test", "--config", "e2e/playwright.config.ts", "--retries=0", "--workers=1", `--repeat-each=${runs}`, ...job.files],
    times: 1,
  };
}

function run(cmd, args, cwd) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, CI: "1" } });
    p.on("exit", code => resolve(code ?? 1));
  });
}

async function main(argv) {
  const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const runs = Number(opt("--runs", "20"));
  if (argv.includes("--job")) return repeat([JSON.parse(opt("--job", ""))], runs, argv.includes("--load"));
  const filesIdx = argv.indexOf("--files");
  const changed = filesIdx >= 0
    ? argv.slice(filesIdx + 1).filter(a => !a.startsWith("--"))
    : git("diff", "--name-only", "--diff-filter=d", `${opt("--base", "origin/main")}...HEAD`);
  const all = git("ls-files", "--cached", "--others", "--exclude-standard");
  const only = opt("--runner", "");
  const jobs = planBurnIn(changed, all).filter(j => !only || j.runner === only);
  if (argv.includes("--matrix")) { console.log(JSON.stringify(groupJobs(jobs, readTimes()))); return 0; }
  if (argv.includes("--plan")) { console.log(JSON.stringify(jobs, null, 2)); return 0; }
  return repeat(jobs, runs, argv.includes("--load"));
}

async function repeat(jobs, runs, load) {
  console.log(JSON.stringify(jobs, null, 2));
  if (jobs.length === 0) { console.log("burn-in: no spec to repeat"); return 0; }

  let hog;
  if (load) {
    hog = spawn("stress-ng", ["--cpu", "1", "--timeout", "3600s"], { stdio: "ignore" });
    hog.on("error", err => { console.error(`burn-in: --load needs stress-ng: ${err.message}`); process.exit(2); });
  }
  let failed = 0;
  try {
    for (const job of jobs) {
      const { cmd, args, times } = commandFor(job, runs);
      for (let i = 1; i <= times; i++) {
        console.log(`\n=== burn-in ${job.runner} ${job.cwd} ${times > 1 ? `run ${i}/${times}` : `x${runs}`} ===`);
        const code = await run(cmd, args, join(repo, job.cwd));
        if (code !== 0) { failed++; console.error(`burn-in: FAILED in ${job.cwd}${times > 1 ? ` on run ${i}` : ""}`); break; }
      }
    }
  } finally {
    hog?.kill();
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // exitCode, not exit(): exit() can cut off output still being written to a pipe (the --matrix line).
  process.exitCode = await main(process.argv.slice(2));
}
