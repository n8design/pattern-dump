// loadConfig validates what it loads, for a .json and a .ts config alike.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      message: `pattern-dump.config.json: invalid config\n  - missing required "styles" (found "style" — did you mean "styles"?)`,
    });
  });

  it("rejects a .ts config the same way", async () => {
    const root = await project("ts", "pattern-dump.config.ts",
      `export default { sourceDir: "s", patternsDir: "p", outDir: "o", styles: { dir: "d" }, overview: false };`);
    await expect(loadConfig(root)).rejects.toThrow(`unknown key "overview" — did you mean "overviews"?`);
  });

  it("loads a valid config", async () => {
    const root = await project("ok", "pattern-dump.config.json",
      JSON.stringify({ sourceDir: "s", patternsDir: "p", outDir: "o", styles: { strategy: "parallel", dir: "d" } }));
    expect((await loadConfig(root)).styles.dir).toBe("d");
  });

  it("reports a missing config file as a ConfigError", async () => {
    await expect(loadConfig(join(dir, "nothing-here"))).rejects.toMatchObject({ name: "ConfigError" });
  });
});
