// Every E2E spec runs: each tracked *.spec.ts under a Playwright config's folder is matched by at least one of that
// config's projects. A spec no project matches never runs, and its suite stays green without it
// (storefront-bench/e2e/categories.spec.ts, step 4 of 0.5.0). The matching is Playwright's own: `playwright test
// --list` reports the files each project takes, without starting a server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CONFIGS = [
  "apps/dev-ui/e2e/playwright.config.ts",
  "storefront-bench/e2e/playwright.config.ts",
  "skins/experimental/e2e/playwright.config.ts",
  "package-bench/e2e/playwright.config.ts",
];

/** The spec files Playwright lists for `config`, relative to the repository. */
function listed(config) {
  const out = execFileSync(process.execPath, [resolve(ROOT, "node_modules/playwright/cli.js"), "test", "--list", "--reporter=json", "-c", config],
    { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const report = JSON.parse(out);
  const rootDir = report.config.rootDir;
  const files = new Set();
  const walk = suite => {
    if (suite.file) files.add(relative(ROOT, resolve(rootDir, suite.file)));
    for (const s of suite.specs ?? []) files.add(relative(ROOT, resolve(rootDir, s.file)));
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites) walk(s);
  return files;
}

/** The tracked spec files under `dir`. */
const tracked = dir => execFileSync("git", ["ls-files", "-z", `${dir}/**/*.spec.ts`, `${dir}/*.spec.ts`], { cwd: ROOT, encoding: "utf-8" })
  .split("\0").filter(Boolean);

for (const config of CONFIGS) {
  test(`every E2E spec under ${dirname(config)} is matched by a Playwright project`, () => {
    const runs = listed(config);
    const unmatched = [...new Set(tracked(dirname(config)))].filter(f => !runs.has(f))
      .map(f => `${f} is matched by no project in ${config}: add it to a project's testMatch`);
    assert.deepEqual(unmatched, []);
  });
}
