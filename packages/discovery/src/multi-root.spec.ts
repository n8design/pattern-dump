// Discovery over several pattern roots (the project, then packages), with excludes.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap, globToRegExp } from "./index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function files(base: string, paths: string[]): Promise<void> {
  for (const p of paths) {
    await mkdir(dirname(join(base, p)), { recursive: true });
    await writeFile(join(base, p), "<p>x</p>\n");
  }
}

describe("globToRegExp", () => {
  it("matches ** across folders, * within one, ? as one character", () => {
    expect(globToRegExp("**/legacy/**").test("organism/dialogs/legacy/a.hbs")).toBe(true);
    expect(globToRegExp("**/legacy/**").test("legacy/a.hbs")).toBe(true);
    expect(globToRegExp("design-tokens/*.hbs").test("design-tokens/blues.hbs")).toBe(true);
    expect(globToRegExp("design-tokens/*.hbs").test("design-tokens/colors/blues.hbs")).toBe(false);
    expect(globToRegExp("a?c.hbs").test("abc.hbs")).toBe(true);
    expect(globToRegExp("a.b").test("aXb")).toBe(false);
  });
});

describe("buildDiscoveryMap — several roots", () => {
  it("merges roots, records each package component's source, and keeps handles root-independent", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-discovery-"));
    const project = join(root, "project"); const lib = join(root, "lib");
    await files(project, ["molecules/search/search.hbs"]);
    await files(lib, ["atoms/button/button.hbs", "atoms/button/button~ghost.json"]);
    const r = await buildDiscoveryMap([{ dir: project }, { dir: lib, source: "@acme/lib" }]);
    expect([...r.discoveryMap.keys()].sort()).toEqual(["atoms/button", "atoms/button~ghost", "molecules/search"]);
    expect(r.discoveryMap.get("atoms/button")?.source).toBe("@acme/lib");
    expect(r.discoveryMap.get("atoms/button~ghost")?.source).toBe("@acme/lib");
    expect(r.discoveryMap.get("molecules/search")?.source).toBeUndefined();
    expect(r.handleMap.get("atoms-button")).toBe("atoms/button");
  });

  it("the project overrides a package component with the same handle — an override, not a collision", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-discovery-"));
    const project = join(root, "project"); const lib = join(root, "lib");
    await files(project, ["atoms/button/button.hbs"]);
    await files(lib, ["atoms/button/button.hbs"]);
    const r = await buildDiscoveryMap([{ dir: project }, { dir: lib, source: "@acme/lib" }]);
    expect(r.discoveryMap.get("atoms/button")?.hbsPath).toBe(join(project, "atoms/button/button.hbs"));
    expect(r.collisions).toEqual([]);
    expect(r.quarantineMap.size).toBe(0);
    expect(r.overrides).toEqual([{
      handle: "atoms-button", id: "atoms/button", path: join(project, "atoms/button/button.hbs"),
      shadowedPath: join(lib, "atoms/button/button.hbs"), shadowedSource: "@acme/lib",
    }]);
  });

  it("a same-handle clash inside ONE root is still a collision", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-discovery-"));
    const lib = join(root, "lib");
    await files(lib, ["atoms/button.hbs", "atoms/group/button.hbs"]);
    const r = await buildDiscoveryMap([{ dir: lib, source: "@acme/lib" }]);
    expect(r.collisions.map(c => c.handle)).toEqual(["atoms-button"]);
    expect(r.overrides).toEqual([]);
  });

  it("excludes files and whole folders by glob, per root", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-discovery-"));
    const lib = join(root, "lib");
    await files(lib, [
      "organism/dialogs/modal.hbs", "organism/dialogs/legacy/modal.hbs",
      "design-tokens/blues.hbs", "design-tokens/colors/blues.hbs",
    ]);
    const r = await buildDiscoveryMap([{ dir: lib, source: "@acme/lib", exclude: ["**/legacy/**", "design-tokens/*.hbs"] }]);
    expect([...r.discoveryMap.keys()].sort()).toEqual(["design-tokens/colors/blues", "organism/dialogs/modal"]);
    expect(r.collisions).toEqual([]);
  });

  it("a plain string is still one root, with no sources", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-discovery-"));
    await files(root, ["atoms/x/x.hbs"]);
    const r = await buildDiscoveryMap(root);
    expect(r.discoveryMap.get("atoms/x")).toMatchObject({ hbsPath: join(root, "atoms/x/x.hbs") });
    expect(r.discoveryMap.get("atoms/x")?.source).toBeUndefined();
    expect(r.overrides).toEqual([]);
  });
});
