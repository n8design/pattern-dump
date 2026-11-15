// loadConfig validates what it loads, for a .json and a .ts config alike.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./index.js";
import { save } from "../../../test-support/save.js";

let dir = "";
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "pd-load-config-")); });
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

async function project(name: string, file: string, text: string): Promise<string> {
  const root = join(dir, name);
  await mkdir(root, { recursive: true });
  await save(join(root, file), text);
  return root;
}

describe("loadConfig", () => {
  it("rejects a .json config with a typo, naming the key", async () => {
    const root = await project("json", "pattern-dump.config.json",
      JSON.stringify({ sourceDir: "s", patternsDir: "p", outDir: "o", style: { dir: "d" } }));
    await expect(loadConfig(root)).rejects.toMatchObject({
      name: "ConfigError",
      message: `pattern-dump.config.json: invalid config\n  - unknown key "style" — did you mean "styles"?`,
    });
  });

  it("rejects a .ts config the same way", async () => {
    const root = await project("ts", "pattern-dump.config.ts",
      `export default { sourceDir: "s", patternsDir: "p", outDir: "o", styles: { dir: "d" }, overview: false };`);
    await expect(loadConfig(root)).rejects.toThrow(`unknown key "overview" — did you mean "overviews"?`);
  });

  it("loads many .ts configs at once, each its own: none fails, none gets another's values", async () => {
    // Agents and scripts start several pd processes at the same moment; each config is bundled to a temp
    // file before it is imported, and two loads must never share one.
    const roots = await Promise.all(Array.from({ length: 20 }, (_, i) => project(`many-${i}`, "pattern-dump.config.ts",
      `export default { sourceDir: "s", patternsDir: "p", outDir: "out-${i}", styles: { strategy: "parallel", dir: "d" } };`)));
    const loaded = await Promise.allSettled(roots.map(r => loadConfig(r)));
    expect(loaded.map(l => l.status === "fulfilled" ? l.value.outDir : `failed: ${String(l.reason).slice(0, 80)}`))
      .toEqual(roots.map((_, i) => `out-${i}`));
  });

  it("loads a valid config", async () => {
    const root = await project("ok", "pattern-dump.config.json",
      JSON.stringify({ sourceDir: "s", patternsDir: "p", outDir: "o", styles: { strategy: "parallel", dir: "d" } }));
    expect((await loadConfig(root)).styles.dir).toBe("d");
  });

  it("reports a missing config file as a ConfigError", async () => {
    await expect(loadConfig(join(dir, "nothing-here"))).rejects.toMatchObject({ name: "ConfigError" });
  });

  it("takes the folders a style guide's own package.json names, and refuses a config that names them differently", async () => {
    const root = await project("own-manifest", "pattern-dump.config.ts", `export default { outDir: "./dist" };`);
    await save(join(root, "package.json"), JSON.stringify({ name: "@acme/ds", patternDump: { patterns: "patterns", styles: { dir: "styles", documentBase: ["base"] }, assets: ["media"] } }));
    const config = await loadConfig(root);
    expect([config.patternsDir, config.styles.dir, config.documentBase, config.assets?.dir]).toEqual(["patterns", "styles", ["base"], ["media"]]);
    const clash = await project("own-manifest-clash", "pattern-dump.config.ts", `export default { outDir: "./dist", patternsDir: "./src/patterns" };`);
    await save(join(clash, "package.json"), JSON.stringify({ name: "@acme/ds", patternDump: { patterns: "patterns" } }));
    await expect(loadConfig(clash)).rejects.toMatchObject({ name: "ConfigError",
      message: `pattern-dump.config.ts: the config and the project's own package manifest disagree
  - "patternsDir" is "./src/patterns" in pattern-dump.config.ts, `
        + `but "patternDump.patterns" is "patterns" in package.json: name it in one of them, or give both the same value` });
  });

  it("a config written with defineConfig names only what it writes: the folders it leaves out come from package.json", async () => {
    // As a project's config file is written: defineConfig imported from the package. Its defaults are not folders
    // the config names, so they never clash with the manifest's.
    // The package's entry as its exports name it ("import": "./dist/index.js").
    const pkg = JSON.stringify(fileURLToPath(new URL("../../config/dist/index.js", import.meta.url)));
    const root = await project("own-manifest-define", "pattern-dump.config.ts",
      `import { defineConfig } from ${pkg};\nexport default defineConfig({ outDir: "./dist" });\n`);
    await save(join(root, "package.json"), JSON.stringify({ name: "@acme/ds", patternDump: { patterns: "patterns", styles: { dir: "styles" } } }));
    const config = await loadConfig(root);
    expect([config.sourceDir, config.patternsDir, config.styles.dir]).toEqual(["./src", "patterns", "styles"]);
    const clash = await project("own-manifest-define-clash", "pattern-dump.config.ts",
      `import { defineConfig } from ${pkg};\nexport default defineConfig({ outDir: "./dist", patternsDir: "./src/patterns" });\n`);
    await save(join(clash, "package.json"), JSON.stringify({ name: "@acme/ds", patternDump: { patterns: "patterns" } }));
    await expect(loadConfig(clash)).rejects.toThrow(`"patternsDir" is "./src/patterns" in pattern-dump.config.ts, but "patternDump.patterns" is "patterns" in package.json`);
  });

  it("leaves a config alone whose package.json has no patternDump field", async () => {
    const root = await project("no-manifest", "pattern-dump.config.ts", `export default { outDir: "./dist" };`);
    await save(join(root, "package.json"), JSON.stringify({ name: "site" }));
    expect((await loadConfig(root)).patternsDir).toBe("./src/patterns");
  });
});
