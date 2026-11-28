// Tests see plain console text: every vitest project and every Playwright config sets FORCE_COLOR=0. Nx gives every
// task FORCE_COLOR=true, Playwright gives its servers and workers FORCE_COLOR=1, and with it set Node colours a pipe,
// so a spied or spawned line would otherwise carry escape codes. NO_COLOR does not help: FORCE_COLOR beats it, and
// Node writes a warning to stderr, which specs read. Each config is checked, so a new one cannot leave it out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const PLAYWRIGHT = 'process.env["FORCE_COLOR"] = "0";';

/** The workspaces whose `test` script runs vitest. */
const vitestProjects = execFileSync("git", ["ls-files", "-z", "*/package.json", "*/*/package.json"], { cwd: ROOT, encoding: "utf-8" })
  .split("\0").filter(Boolean)
  .filter(f => /vitest/.test(JSON.parse(readFileSync(join(ROOT, f), "utf-8")).scripts?.test ?? ""))
  .map(f => dirname(f));

test("the vitest projects are found", () => {
  assert.ok(vitestProjects.includes("packages/dev-server") && vitestProjects.includes("packages/config"), vitestProjects.join(", "));
});

for (const project of vitestProjects) {
  test(`${project}: its vitest config sets FORCE_COLOR=0`, async () => {
    const file = join(ROOT, project, "vitest.config.ts");
    assert.ok(existsSync(file), `${project} has no vitest.config.ts`);
    const config = (await import(pathToFileURL(file).href)).default;
    assert.equal(config.test?.env?.FORCE_COLOR, "0");
  });
}

const playwrightConfigs = execFileSync("git", ["ls-files", "-z", "**/playwright.config.ts"], { cwd: ROOT, encoding: "utf-8" })
  .split("\0").filter(Boolean);

test("the Playwright configs are found", () => {
  assert.ok(playwrightConfigs.length >= 5, playwrightConfigs.join(", "));
});

for (const config of playwrightConfigs) {
  test(`${config}: sets FORCE_COLOR=0 for its servers and workers`, () => {
    // Asserted on the text: loading a config starts nothing, but some write fixtures as they load.
    assert.ok(readFileSync(join(ROOT, config), "utf-8").split("\n").includes(PLAYWRIGHT), `${config} lacks ${PLAYWRIGHT}`);
  });
}
