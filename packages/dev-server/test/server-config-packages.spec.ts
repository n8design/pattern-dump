// `styles: false` on a package reference leaves that package's stylesheets out: no style root, and its
// documentBase does not turn the base layer on. The rest of the package is still used.
import { describe, it, expect } from "vitest";
import { defineConfig } from "@pattern-dump/config";
import { resolveServerConfig } from "../src/server-config.js";
import type { ResolvedPackage } from "../src/packages.js";

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});

const core = (styles: boolean): ResolvedPackage => ({
  name: "@acme/core", version: "1.0.0", dir: "/nm/@acme/core", exclude: [], direct: false, styles,
  manifest: { styles: { dir: "sass", entry: "core.scss", documentBase: ["00-base"] }, themes: { dir: "sass/themes" } },
});

describe("package styles opt-out", () => {
  it("a package's styles are a style root by default", () => {
    const cfg = resolveServerConfig(config, "/project", {}, [core(true)]);
    expect(cfg.styleRoots.map(r => r.source)).toContain("@acme/core");
    expect(cfg.documentBaseEnabled).toBe(true);
  });

  it("styles: false leaves them out, but keeps the package's themes", () => {
    const cfg = resolveServerConfig(config, "/project", {}, [core(false)]);
    expect(cfg.styleRoots.map(r => r.source)).not.toContain("@acme/core");
    expect(cfg.documentBaseEnabled).toBe(false);
    expect(cfg.themeDirs).toContain("/nm/@acme/core/sass/themes");
  });
});
