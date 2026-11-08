// The burn-in's mapping from changed files to the specs it repeats. Run: npm run test:scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planBurnIn, runnerOf, commandFor } from "./burn-in.mjs";

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
