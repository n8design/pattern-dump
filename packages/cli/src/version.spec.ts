// `pd --version` and `pd -v` print the installed version and exit 0 (CLI-109). Runs the built binary.
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import cliPackage from "../package.json" with { type: "json" };

const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const run = (...args: string[]) => promisify(execFile)(process.execPath, [bin, ...args]);

describe("pd --version", () => {
  for (const flag of ["--version", "-v"]) {
    it(`${flag}: prints the version, exits 0`, async () => {
      const { stdout, stderr } = await run(flag);
      expect(stdout).toBe(`${cliPackage.version}\n`);
      expect(stderr).toBe("");
    });
  }
});
