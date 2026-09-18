import { describe, it, expect } from "vitest";
import { configProblems, validateConfig } from "./validate.js";

const valid = {
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles", entry: "styles.scss" },
  themes: { dir: "./themes", default: "light", switch: "attribute", swatch: { slots: ["--a"] } },
  assets: { strategy: "central", dir: ["./assets/images", "./assets/css"], css: ["css/fonts.css"] },
  scriptsDir: "./src/scripts", globalScripts: ["nav", "https://cdn.example/x.js"],
  dataDir: "./src/data", helpers: "./src/helpers", documentBase: ["base"], overviews: false,
  shell: { brand: { title: "T", logo: { light: "/a.svg", dark: "/b.svg" }, logoAlt: "T", href: "/" } },
  packages: ["pkg-a", { name: "pkg-b", exclude: ["x/**"] }], exclude: ["drafts/**"],
  build: { outDir: "./site", basePath: "/docs/", audit: false },
};

describe("configProblems", () => {
  it("accepts every documented option", () => {
    expect(configProblems(valid)).toEqual([]);
  });

  it("accepts the minimal config, with no strategy", () => {
    expect(configProblems({ sourceDir: "s", patternsDir: "p", outDir: "o", styles: { dir: "d" } })).toEqual([]);
  });

  it("names a missing required key, and the typo that probably meant it", () => {
    const { styles, ...rest } = valid;
    expect(configProblems({ ...rest, style: styles }))
      .toEqual([`missing required "styles" (found "style" — did you mean "styles"?)`]);
    expect(configProblems({ ...rest })).toEqual([`missing required "styles"`]);
  });

  it("rejects unknown keys at any depth, with a suggestion when one is close", () => {
    expect(configProblems({ ...valid, dataDirectory: "x", colour: 1 })).toEqual([
      `unknown key "dataDirectory"`,
      `unknown key "colour"`,
    ]);
    expect(configProblems({ ...valid, overview: true })).toEqual([`unknown key "overview" — did you mean "overviews"?`]);
    expect(configProblems({ ...valid, styles: { ...valid.styles, entries: "x" } }))
      .toEqual([`unknown key "styles.entries" — did you mean "styles.entry"?`]);
  });

  it("reports wrong value types by path", () => {
    expect(configProblems({ ...valid, overviews: "no", assets: { dir: 3 }, themes: { dir: "t" } })).toEqual([
      `missing required "themes.default"`,
      `"assets.dir" must be a string or a list of strings`,
      `"overviews" must be true or false`,
    ]);
  });

  it("rejects the strategies that are not implemented, instead of ignoring them", () => {
    expect(configProblems({ ...valid, styles: { ...valid.styles, strategy: "co-located" } }))
      .toEqual([`"styles.strategy": "co-located" is not supported yet — use "parallel", or leave it out`]);
    expect(configProblems({ ...valid, assets: { strategy: "component-relative" } }))
      .toEqual([`"assets.strategy": "component-relative" is not supported yet — use "central", or leave it out`]);
    expect(configProblems({ ...valid, styles: { ...valid.styles, strategy: "flat" } }))
      .toEqual([`"styles.strategy" must be "parallel"`]);
  });

  it("rejects a config that is not an object", () => {
    expect(configProblems(undefined)).toHaveLength(1);
    expect(configProblems([])).toHaveLength(1);
  });
});

describe("validateConfig", () => {
  it("throws one error listing every problem, prefixed with the file", () => {
    expect(() => validateConfig({ sourceDir: 1 }, "pattern-dump.config.json")).toThrow(
      `pattern-dump.config.json: invalid config\n` +
      `  - missing required "patternsDir"\n` +
      `  - missing required "outDir"\n` +
      `  - missing required "styles"\n` +
      `  - "sourceDir" must be a string`);
  });

  it("returns a valid config unchanged", () => {
    expect(validateConfig(valid, "x")).toBe(valid);
  });
});
