import { describe, expect, it } from "vitest";
import { withOwnManifest } from "./own-manifest.js";

const where = { config: "pattern-dump.config.ts", manifest: "package.json" };
const MANIFEST = {
  patterns: "patterns", data: "data", helpers: "helpers/index.js", scripts: "scripts", globalScripts: ["nav"], exclude: ["drafts/**"],
  assets: ["media/images", "media/fonts"],
  styles: { dir: "styles", entry: "index.scss", documentBase: ["base"] },
  themes: { dir: "themes", default: "light", switch: "attribute" },
};

describe("withOwnManifest — the config takes the folders its own package manifest names", () => {
  it("fills in every field the config leaves out", () => {
    expect(withOwnManifest({ outDir: "./dist" }, MANIFEST, where)).toEqual({
      outDir: "./dist", patternsDir: "patterns", dataDir: "data", helpers: "helpers/index.js", scriptsDir: "scripts",
      globalScripts: ["nav"], exclude: ["drafts/**"], assets: { dir: ["media/images", "media/fonts"] },
      styles: { dir: "styles", entry: "index.scss" }, documentBase: ["base"],
      themes: { dir: "themes", default: "light", switch: "attribute" },
    });
  });

  it("keeps what the config sets beside what it takes: other keys of the same object", () => {
    expect(withOwnManifest({ outDir: "./dist", styles: { strategy: "parallel" }, assets: { css: ["x.css"] } },
      { styles: { dir: "styles" }, assets: ["media"] }, where))
      .toEqual({ outDir: "./dist", styles: { strategy: "parallel", dir: "styles" }, assets: { css: ["x.css"], dir: ["media"] } });
  });

  it("accepts the same value in both, written either way", () => {
    const config = { outDir: "./dist", patternsDir: "./patterns/", styles: { dir: "./styles" }, documentBase: ["./base"],
      assets: { dir: "./media/images" }, themes: { default: "light" } };
    expect(withOwnManifest(config, { patterns: "patterns", styles: { dir: "styles", documentBase: ["base"] }, assets: ["media/images"],
      themes: { default: "light" } }, where)).toEqual(config);
  });

  it("refuses a different value in both, naming every field and both files", () => {
    expect(() => withOwnManifest({ outDir: "./dist", patternsDir: "./src/patterns", styles: { dir: "./styles" }, documentBase: ["base", "site"] },
      { patterns: "patterns", styles: { dir: "styles", documentBase: ["base"] } }, where)).toThrow(
      `pattern-dump.config.ts: the config and the project's own package manifest disagree\n`
      + `  - "patternsDir" is "./src/patterns" in pattern-dump.config.ts, but "patternDump.patterns" is "patterns" in package.json: name it in one of them, or give both the same value\n`
      + `  - "documentBase" is ["base","site"] in pattern-dump.config.ts, but "patternDump.styles.documentBase" is ["base"] in package.json: name it in one of them, or give both the same value`);
  });

  it("changes nothing without a manifest, and never changes the config it was given", () => {
    const raw = { outDir: "./dist" };
    expect(withOwnManifest(raw, undefined, where)).toBe(raw);
    const before = JSON.stringify(raw);
    withOwnManifest(raw, MANIFEST, where);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
