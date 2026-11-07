// The bench's two packages are consumed as git submodules are: relative file: dependencies on plain
// folders in vendor/, which npm links into node_modules. Each is a symlink whose real folder is outside
// node_modules, and each ships compiled helpers that its manifest names.
import { describe, expect, it } from "vitest";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageDir, loadPatternPackages } from "../../packages/dev-server/src/packages.js";

const bench = fileURLToPath(new URL("../", import.meta.url));
const PACKAGES: Array<[name: string, folder: string]> = [["pd-fixture-ds", "fixture-ds"], ["pd-fixture-skin", "fixture-skin"]];

describe("the bench's packages", () => {
  for (const [name, folder] of PACKAGES) {
    it(`${name} is a symlink in node_modules to vendor/${folder}, outside node_modules`, () => {
      const link = findPackageDir(name, bench)!;
      expect(link.split(sep)).toContain("node_modules");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      const real = realpathSync(link);
      expect(real).toBe(realpathSync(join(bench, "vendor", folder)));
      expect(real.split(sep)).not.toContain("node_modules");
    });

    it(`${name} ships compiled helpers, named by its manifest and built`, () => {
      const manifest = JSON.parse(readFileSync(join(bench, "vendor", folder, "package.json"), "utf8")) as { patternDump: { helpers: string } };
      expect(manifest.patternDump.helpers).toBe("dist/helpers.js");
      expect(existsSync(join(bench, "vendor", folder, "dist", "helpers.js"))).toBe(true);
    });
  }

  it("are both loaded as linked packages, from their real folders", () => {
    expect(loadPatternPackages(["pd-fixture-ds", "pd-fixture-skin"], bench).map(p => [p.name, p.linked, p.dir])).toEqual(
      PACKAGES.map(([name, folder]) => [name, true, realpathSync(join(bench, "vendor", folder))]),
    );
  });
});
