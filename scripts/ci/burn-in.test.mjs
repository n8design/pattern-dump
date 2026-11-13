// The burn-in's mapping from changed files to the specs it repeats. Run: npm run test:scripts
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { planBurnIn, runnerOf, commandFor, groupJobs, DEFAULT_SECONDS, MIN_GROUP_SECONDS } from "./burn-in.mjs";
import { timesFromLog } from "./burn-in-times.mjs";

const ALL = [
  "packages/dev-server/test/watcher.spec.ts",
  "packages/dev-server/test/watcher-queue.spec.ts",
  "packages/dev-server/test/reload.spec.ts",
  "packages/dev-server/test/lazy.spec.ts",
  "packages/dev-server/test/watch-harness.ts",
  "packages/dev-server/src/watch.ts",
  "packages/render/test/render.spec.ts",
  "apps/dev-ui/e2e/hmr.spec.ts",
  "apps/dev-ui/e2e/static/site.spec.ts",
  "storefront-bench/e2e/hmr.spec.ts",
  "storefront-bench/e2e/add-page.spec.ts",
  "skins/experimental/test/skin.spec.ts",
  "test-support/save.ts",
  "README.md",
];

test("every spec in the repository has a runner, wherever its workspace keeps it", () => {
  const tracked = spawnSync("git", ["ls-files"], { encoding: "utf8" }).stdout.split("\n");
  const specs = tracked.filter(f => /\.(spec|test)\.(ts|mjs)$/.test(f));
  assert.ok(specs.length > 200, `found ${specs.length} specs`);
  assert.deepEqual(specs.filter(f => runnerOf(f) === null), []);
});

test("runnerOf: specs beside the code (src/) run with vitest in their workspace; the scripts' tests with node --test", () => {
  assert.deepEqual(runnerOf("packages/cli/src/init/starter.spec.ts"), { runner: "vitest", cwd: "packages/cli" });
  assert.deepEqual(runnerOf("apps/dev-ui/src/core/cvd-math.spec.ts"), { runner: "vitest", cwd: "apps/dev-ui" });
  assert.deepEqual(runnerOf("packages/contracts/src/routes.spec.ts"), { runner: "vitest", cwd: "packages/contracts" });
  assert.deepEqual(runnerOf("scripts/ci/burn-in.test.mjs"), { runner: "node", cwd: "." });
  assert.deepEqual(planBurnIn(["packages/cli/src/init/starter.spec.ts"], ["packages/cli/src/init/starter.spec.ts"]),
    [{ runner: "vitest", cwd: "packages/cli", files: ["src/init/starter.spec.ts"] }]);
  // A .mjs file that is no test, and a Playwright suite's helper, are still not specs.
  assert.equal(runnerOf("scripts/ci/burn-in.mjs"), null);
  assert.equal(runnerOf("apps/dev-ui/e2e/static-server.mjs"), null);
});

test("commandFor: a node --test job repeats the process", () => {
  assert.deepEqual(commandFor({ runner: "node", cwd: ".", files: ["scripts/ci/burn-in.test.mjs"] }, 20),
    { cmd: "node", args: ["--test", "scripts/ci/burn-in.test.mjs"], times: 20 });
});

test("runnerOf: vitest per workspace, Playwright per suite, nothing for other files", () => {
  assert.deepEqual(runnerOf("packages/render/test/render.spec.ts"), { runner: "vitest", cwd: "packages/render" });
  assert.deepEqual(runnerOf("skins/experimental/test/skin.spec.ts"), { runner: "vitest", cwd: "skins/experimental" });
  assert.deepEqual(runnerOf("apps/dev-ui/e2e/hmr.spec.ts"), { runner: "playwright", cwd: "apps/dev-ui" });
  assert.deepEqual(runnerOf("apps/dev-ui/e2e/static/site.spec.ts"), { runner: "playwright", cwd: "apps/dev-ui" });
  assert.equal(runnerOf("packages/dev-server/test/watch-harness.ts"), null);
  assert.equal(runnerOf("README.md"), null);
});

test("a changed spec is repeated, with its path relative to its workspace", () => {
  assert.deepEqual(planBurnIn(["packages/dev-server/test/lazy.spec.ts"], ALL),
    [{ runner: "vitest", cwd: "packages/dev-server", files: ["test/lazy.spec.ts"] }]);
});

test("changed files that are no spec, and a spec that no longer exists, give no job", () => {
  assert.deepEqual(planBurnIn(["README.md", "packages/render/test/gone.spec.ts"], ALL), []);
});

test("specs in different workspaces are different jobs", () => {
  const jobs = planBurnIn(["packages/render/test/render.spec.ts", "apps/dev-ui/e2e/hmr.spec.ts", "storefront-bench/e2e/add-page.spec.ts"], ALL);
  assert.deepEqual(jobs.map(j => `${j.runner}:${j.cwd}`).sort(),
    ["playwright:apps/dev-ui", "playwright:storefront-bench", "vitest:packages/render"]);
});

for (const changed of ["packages/dev-server/test/watch-harness.ts", "test-support/save.ts", "packages/dev-server/src/watch.ts"]) {
  test(`${changed} burns in every watcher spec, reload and storefront hmr`, () => {
    const jobs = planBurnIn([changed], ALL);
    assert.deepEqual(jobs, [
      { runner: "vitest", cwd: "packages/dev-server", files: ["test/reload.spec.ts", "test/watcher-queue.spec.ts", "test/watcher.spec.ts"] },
      { runner: "playwright", cwd: "storefront-bench", files: ["e2e/hmr.spec.ts"] },
    ]);
  });
}

test("a spec both changed and named by a rule is listed once", () => {
  const jobs = planBurnIn(["packages/dev-server/src/watch.ts", "packages/dev-server/test/reload.spec.ts"], ALL);
  assert.equal(jobs.find(j => j.runner === "vitest").files.filter(f => f === "test/reload.spec.ts").length, 1);
});

test("commandFor: vitest repeats the process with retries off, Playwright repeats within one run", () => {
  const v = commandFor({ runner: "vitest", cwd: "packages/x", files: ["test/a.spec.ts"] }, 20);
  assert.equal(v.times, 20);
  assert.ok(v.args.includes("--retry=0"));
  const p = commandFor({ runner: "playwright", cwd: "apps/dev-ui", files: ["e2e/a.spec.ts"] }, 20);
  assert.equal(p.times, 1);
  assert.ok(p.args.includes("--repeat-each=20") && p.args.includes("--retries=0"));
});

// The split into groups, one CI job each.
const DEV = f => `test/${f}.spec.ts`;
const devJob = files => ({ runner: "vitest", cwd: "packages/dev-server", files: files.map(DEV) });
const secs = Object.fromEntries(Object.entries({ a: 20, b: 11, c: 9, d: 6, e: 5, f: 4, g: 3, h: 2 })
  .map(([k, v]) => [`packages/dev-server/${DEV(k)}`, v]));

test("groupJobs: every spec in exactly one group, of the job's runner and cwd", () => {
  const job = devJob(["a", "b", "c", "d", "e", "f", "g", "h"]);
  const groups = groupJobs([job], secs, { "packages/dev-server": 3 });
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.flatMap(g => g.files).sort(), [...job.files].sort());
  for (const g of groups) assert.deepEqual([g.runner, g.cwd], ["vitest", "packages/dev-server"]);
  assert.deepEqual(groups.map(g => g.name), ["packages/dev-server 1/3", "packages/dev-server 2/3", "packages/dev-server 3/3"]);
});

test("groupJobs: the slowest spec first, each into the group with the least time so far", () => {
  const groups = groupJobs([devJob(["a", "b", "c", "d", "e", "f", "g", "h"])], secs, { "packages/dev-server": 3 });
  // a 20 → 1; b 11 → 2; c 9 → 3; d 6 → 3 (15); e 5 → 2 (16); f 4 → 3 (19); g 3 → 2 (19); h 2 → 2, the first
  // of the two least (21). The slowest stays alone; the rest even out against it.
  assert.deepEqual(groups.map(g => [g.files, g.seconds]), [
    [[DEV("a")], 20],
    [[DEV("b"), DEV("e"), DEV("g"), DEV("h")], 21],
    [[DEV("c"), DEV("d"), DEV("f")], 19],
  ]);
});

test("groupJobs: placed by time, not by name: the slowest spec alone though it sorts last", () => {
  const t = { "packages/dev-server/test/z.spec.ts": 30, "packages/dev-server/test/m.spec.ts": 5,
    "packages/dev-server/test/n.spec.ts": 5 };
  const groups = groupJobs([devJob(["m", "n", "z"])], t, { "packages/dev-server": 2 });
  assert.deepEqual(groups.map(g => g.files), [[DEV("z")], [DEV("m"), DEV("n")]]);
});

test("groupJobs: a workspace not in the table is one group, named by its cwd", () => {
  const job = { runner: "playwright", cwd: "storefront-bench", files: ["e2e/a.spec.ts", "e2e/b.spec.ts"] };
  assert.deepEqual(groupJobs([job], {}, {}),
    [{ name: "storefront-bench", runner: "playwright", cwd: "storefront-bench", files: job.files, seconds: 4 }]);
});

test("groupJobs: no group under MIN_GROUP_SECONDS, and no more groups than specs", () => {
  // 3 + 2 = 5 s: one group, though three are allowed.
  assert.equal(groupJobs([devJob(["g", "h"])], secs, { "packages/dev-server": 3 }).length, 1);
  // 20 + 11 = 31 s: two groups of one spec each, not three.
  assert.equal(groupJobs([devJob(["a", "b"])], secs, { "packages/dev-server": 3 }).length, 2);
  assert.ok(2 * MIN_GROUP_SECONDS <= 31);
});

test("groupJobs: a spec with no measurement counts DEFAULT_SECONDS", () => {
  const [g] = groupJobs([devJob(["new"])], {}, {});
  assert.equal(g.seconds, DEFAULT_SECONDS);
});

test("timesFromLog: vitest test time plus a share of collect; Playwright summed over the repeats", () => {
  const log = [
    "2026-11-10T22:28:45.9725469Z === burn-in vitest packages/dev-server run 1/2 ===",
    "2026-11-10T22:28:59.1Z  \x1b[32m✓\x1b[39m test/a.spec.ts \x1b[2m(\x1b[22m\x1b[2m18 tests\x1b[22m\x1b[2m)\x1b[22m\x1b[33m 9000\x1b[2mms\x1b[22m\x1b[39m",
    "2026-11-10T22:28:59.1Z  ✓ test/b.spec.ts (2 tests) 1000ms",
    "2026-11-10T22:30:40.3Z    Duration  12.00s (transform 1.31s, setup 0ms, collect 4.00s, tests 10.00s, environment 4ms, prepare 1.50s)",
    "=== burn-in vitest packages/dev-server run 2/2 ===",
    " ❯ test/a.spec.ts (18 tests | 1 failed) 11000ms",
    " ✓ test/b.spec.ts (2 tests) 1000ms",
    "   Duration  14.00s (transform 1.31s, setup 0ms, collect 4.00s, tests 12.00s)",
    "=== burn-in playwright storefront-bench x2 ===",
    "  ✓     1 [storefront] › e2e/p.spec.ts:12:3 › a page › shows (2.4s)",
    "  ✓     2 [storefront] › e2e/p.spec.ts:20:3 › a page › hides (600ms)",
    "  ✘     3 [storefront] › e2e/p.spec.ts:12:3 › a page › shows (3.0s)",
    "  ✓     4 [storefront] › e2e/p.spec.ts:20:3 › a page › hides (1.0s)",
  ].join("\n");
  assert.deepEqual(timesFromLog(log), {
    "packages/dev-server/test/a.spec.ts": 12, // (9 + 11) / 2 + 4 / 2
    "packages/dev-server/test/b.spec.ts": 3, //  1 + 4 / 2
    "storefront-bench/e2e/p.spec.ts": 3.5, //   (2.4 + 0.6 + 3.0 + 1.0) / 2
  });
});
