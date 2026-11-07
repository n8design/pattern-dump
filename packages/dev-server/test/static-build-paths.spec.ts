// A static build names no folder of the machine it was built on: no absolute path, no home or temp
// folder, no path of the checkout, in any file of the snapshot. Scripts name their source by file only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { validateConfig } from "@pattern-dump/config";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const testBench = join(repo, "test-bench");
const TEXT = new Set([".html", ".json", ".js", ".css", ".svg", ".txt", ".md"]);
let tmp = "";
let out = "";

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-build-paths-"));
  out = join(tmp, "site");
  await buildStaticSite(validateConfig(testBenchConfig, "test-bench"), testBench, { outDir: out, basePath: "/pd/", pdVersion: "0.0.0-test" });
}, 120_000);
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

async function textFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const p = join(e.parentPath, e.name);
    if (e.isFile() && TEXT.has(extname(e.name))) files.set(relative(dir, p), await readFile(p, "utf8"));
  }
  return files;
}

describe("a test-bench build", () => {
  it("names no folder of the machine in any text file", async () => {
    const needles = [repo.replace(/\/$/, ""), homedir(), tmpdir(), "/Volumes/", "/Users/", "/private/", "/home/"];
    const found: string[] = [];
    const files = await textFiles(out);
    expect(files.size).toBeGreaterThan(100);
    for (const [file, text] of files) for (const n of needles) if (text.includes(n)) found.push(`${file}: ${n}`);
    expect(found).toEqual([]);
  });

  it("names a compiled script's source by its file only", async () => {
    const banner = (await readFile(join(out, "_pd", "scripts", "toggle.js"), "utf8")).split("\n")[0];
    expect(banner).toBe("// toggle.ts");
  });
});
