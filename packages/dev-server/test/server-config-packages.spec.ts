// `styles: false` on a package reference leaves that package's stylesheets out: no style root, and its
// documentBase does not turn the base layer on. The rest of the package is still used.
import { describe, it, expect, vi } from "vitest";
import { defineConfig } from "@pattern-dump/config";
import { resolveServerConfig } from "../src/server-config.js";
import type { ResolvedPackage } from "../src/packages.js";
import { surfaceDefaultTheme } from "../src/surfacing.js";

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

// A package theme can be the default with no project themes folder: `themes: { default }` alone.
describe("package theme as the default", () => {
  const withTheme = { ...core(true), manifest: { themes: { dir: "sass/themes", default: "blue" } } } as ResolvedPackage;

  it("themes: { default } without dir uses only the packages' theme folders", () => {
    const cfg = resolveServerConfig({ ...config, themes: { default: "dark" } }, "/project", {}, [withTheme]);
    expect(cfg.themeDirs).toEqual(["/nm/@acme/core/sass/themes"]);
    expect(cfg.defaultTheme).toBe("dark");
  });

  it("a project themes folder still comes first", () => {
    const cfg = resolveServerConfig({ ...config, themes: { dir: "./themes", default: "dark" } }, "/project", {}, [withTheme]);
    expect(cfg.themeDirs).toEqual(["/project/themes", "/nm/@acme/core/sass/themes"]);
  });

  it("warns when the default matches no theme, naming the ones there are", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    surfaceDefaultTheme("dark", ["blue", "teams"]);
    surfaceDefaultTheme("blue", ["blue", "teams"]);
    expect(warn.mock.calls.map(c => c[0])).toEqual([`[dev-server] themes.default "dark" matches no theme; available: blue, teams`]);
    warn.mockRestore();
  });
});
