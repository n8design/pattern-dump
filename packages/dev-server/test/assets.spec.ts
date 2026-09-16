// Asset resolution must work both inside the monorepo and in an installed package, where the
// monorepo-relative paths that used to be hard-coded simply do not exist.

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolveAxeCore, resolveDevUiDist } from "../src/assets.js";

describe("resolveDevUiDist", () => {
  it("prefers a dev-ui/ folder next to the running module (the packaged layout)", () => {
    const url = "file:///opt/app/node_modules/pattern-dump/dist/index.js";
    const dir = resolveDevUiDist(url, p => p === "/opt/app/node_modules/pattern-dump/dist/dev-ui/main.js");
    expect(dir).toBe("/opt/app/node_modules/pattern-dump/dist/dev-ui/");
  });

  it("falls back to apps/dev-ui/dist in the monorepo layout", () => {
    const url = "file:///repo/packages/dev-server/dist/index.js";
    expect(resolveDevUiDist(url, () => false)).toBe("/repo/apps/dev-ui/dist/");
  });
});

describe("resolveAxeCore", () => {
  it("resolves axe-core as a dependency, to a file that exists", () => {
    const path = resolveAxeCore(import.meta.url);
    expect(path).toMatch(/axe-core[\\/]axe\.min\.js$/);
    expect(existsSync(path)).toBe(true);
  });
});
