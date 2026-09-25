// Pattern package resolution, on throwaway node_modules trees.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPackageDir, loadPatternPackages } from "../src/packages.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function pkg(base: string, name: string, json: Record<string, unknown>): Promise<string> {
  const dir = join(base, "node_modules", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name, version: "1.2.3", ...json }));
  return dir;
}

describe("loadPatternPackages", () => {
  it("returns nothing when no packages are named", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-packages-"));
    expect(loadPatternPackages(undefined, root)).toEqual([]);
  });

  it("reads a named package's manifest and follows a peer that has one", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-packages-"));
    const patterns = await pkg(root, "@acme/patterns", {
      patternDump: { patterns: "_patterns", exclude: ["legacy/**"] },
      peerDependencies: { "@acme/core": "1.2.3", "left-pad": "*" },
    });
    const core = await pkg(root, "@acme/core", { patternDump: { styles: { dir: "sass" } } });
    await pkg(root, "left-pad", {}); // a peer without a manifest contributes nothing

    expect(loadPatternPackages([{ name: "@acme/patterns", exclude: ["drafts/**"] }], root)).toEqual([
      { name: "@acme/patterns", version: "1.2.3", dir: patterns, manifest: { patterns: "_patterns", exclude: ["legacy/**"] }, exclude: ["legacy/**", "drafts/**"], direct: true, styles: true },
      { name: "@acme/core", version: "1.2.3", dir: core, manifest: { styles: { dir: "sass" } }, exclude: [], direct: false, styles: true },
    ]);
  });

  it("lists a package once even when it is named and also a peer", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-packages-"));
    await pkg(root, "a", { patternDump: {}, peerDependencies: { b: "*" } });
    await pkg(root, "b", { patternDump: {} });
    expect(loadPatternPackages(["b", "a"], root).map(p => [p.name, p.direct])).toEqual([["b", true], ["a", true]]);
  });

  it("applies a named package's options even when it is first reached as a peer", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-packages-"));
    await pkg(root, "@acme/patterns", { patternDump: {}, peerDependencies: { "@acme/core": "*" } });
    await pkg(root, "@acme/core", { patternDump: { styles: { dir: "sass" } } });
    const loaded = loadPatternPackages(["@acme/patterns", { name: "@acme/core", styles: false, exclude: ["x/**"] }], root);
    expect(loaded.map(p => [p.name, p.styles, p.exclude])).toEqual([
      ["@acme/patterns", true, []],
      ["@acme/core", false, ["x/**"]],
    ]);
  });

  it("names the install command for a package that is not installed", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-packages-"));
    expect(() => loadPatternPackages(["@acme/missing"], root)).toThrow("npm install --save-dev @acme/missing");
  });

  it("explains a named package without a manifest", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-packages-"));
    await pkg(root, "plain", {});
    expect(() => loadPatternPackages(["plain"], root)).toThrow('"plain" has no "patternDump" field');
  });

  it("finds a package hoisted above the project root", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-packages-"));
    const project = join(root, "apps/site");
    await mkdir(project, { recursive: true });
    const dir = await pkg(root, "hoisted", { patternDump: {} });
    expect(findPackageDir("hoisted", project)).toBe(dir);
  });
});
