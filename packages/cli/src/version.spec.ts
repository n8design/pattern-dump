// `pd --version` and `pd -v` print the installed version and exit 0 (CLI-109). Runs the built binary.
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import cliPackage from "../package.json" with { type: "json" };

const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const run = (...args: string[]) => promisify(execFile)(process.execPath, [bin, ...args]);

// Each test starts a new Node process, and the CLI imports @pattern-dump/core (the whole dev server) before it reads
// its arguments: about 0.8 s on an idle machine, but several times that while the other packages' suites run in
// parallel. Vitest's default 5 s is too short for that, so these tests get the 60 s the other process-starting specs
// have.
const SPAWN_TIMEOUT = 60_000;

describe("pd --version", () => {
  for (const flag of ["--version", "-v"]) {
    it(`${flag}: prints the version, exits 0`, async () => {
      const { stdout, stderr } = await run(flag);
      expect(stdout).toBe(`${cliPackage.version}\n`);
      expect(stderr).toBe("");
    }, SPAWN_TIMEOUT);
  }
});
