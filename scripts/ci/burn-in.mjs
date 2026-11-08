// Burn-in: run the specs a pull request touches many times, with retries off, so a test that passes
// only now and then fails here instead of on main.
//
//   node scripts/ci/burn-in.mjs --base origin/main            plan from `git diff`, then run it
//   node scripts/ci/burn-in.mjs --plan --files a.spec.ts ...  print the plan for these changed files
//   --runs N      repetitions (default 20)
//   --load        run one CPU hog (`stress-ng --cpu 1`) beside the repetitions, as a loaded runner would
//
// The mapping from changed files to specs is `planBurnIn` below, and its cases are in burn-in.test.mjs.
import { spawn, spawnSync } from "node:child_process";
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

/** Where a spec runs: vitest in its workspace, or Playwright in its suite. Null for a file that is no spec. */
export function runnerOf(file) {
  if (!SPEC.test(file)) return null;
  for (const suite of PLAYWRIGHT) {
    if (file.startsWith(`${suite}/e2e/`)) return { runner: "playwright", cwd: suite };
  }
  const m = /^((?:packages|apps|skins)\/[^/]+|package-bench|storefront-bench|test-bench)\/(?:[^/]+\/)*test\//.exec(file);
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

function git(...args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.split("\n").filter(Boolean);
}

/** The command for one repetition (vitest) or for all of them (Playwright repeats within one run). */
export function commandFor(job, runs) {
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
  const filesIdx = argv.indexOf("--files");
  const changed = filesIdx >= 0
    ? argv.slice(filesIdx + 1).filter(a => !a.startsWith("--"))
    : git("diff", "--name-only", "--diff-filter=d", `${opt("--base", "origin/main")}...HEAD`);
  const all = git("ls-files", "--cached", "--others", "--exclude-standard");
  const jobs = planBurnIn(changed, all);
  console.log(JSON.stringify(jobs, null, 2));
  if (argv.includes("--plan")) return 0;
  if (jobs.length === 0) { console.log("burn-in: no spec to repeat"); return 0; }

  let hog;
  if (argv.includes("--load")) {
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
  process.exit(await main(process.argv.slice(2)));
}
