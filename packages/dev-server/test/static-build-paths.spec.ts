// A static build names no folder of the machine it was built on: no absolute path, no home or temp
// folder, no path of the checkout, in any file of the snapshot. Scripts name their source by file only. A site with
// mounts as well: nothing in its output is a link, and no file names a folder of the machine.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, lstat, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStaticSite } from "../src/static-build.js";
import { validateConfig } from "@pattern-dump/config";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";
import mountsBenchConfig from "../../../mounts-bench/site/pattern-dump.config.js";
import { writeImages } from "../../../mounts-bench/make-images.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const testBench = join(repo, "test-bench");
const TEXT = new Set([".html", ".json", ".js", ".css", ".svg", ".txt", ".md", ".xml", ".webmanifest"]);
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

describe("a mounts-bench build", () => {
  let site = "";
  beforeAll(async () => {
    const dir = join(tmp, "mounts");
    await cp(join(repo, "mounts-bench"), dir, { recursive: true, filter: src => !/[/\\](?:\.out|dist|node_modules)$/.test(src) });
    await writeImages(dir);
    // A link inside a mount, to a file and to a folder of it: each is published as what it points to.
    await symlink(join(dir, "tool", "style.css"), join(dir, "tool", "same.css"));
    await symlink("guide", join(dir, "tool", "manual"));
    await buildStaticSite(validateConfig(mountsBenchConfig, "mounts-bench"), join(dir, "site"), { outDir: join(dir, "site", "dist"), pdVersion: "0.0.0-test" });
    site = join(dir, "site", ".out", "site");
  }, 120_000);

  it("writes no link: a link in a mount is the file it points to", async () => {
    const links: string[] = [];
    for (const e of await readdir(site, { recursive: true, withFileTypes: true })) {
      if ((await lstat(join(e.parentPath, e.name))).isSymbolicLink()) links.push(relative(site, join(e.parentPath, e.name)));
    }
    expect(links).toEqual([]);
    expect(await readFile(join(site, "tool", "same.css"), "utf8")).toBe(await readFile(join(site, "tool", "style.css"), "utf8"));
    expect(await readFile(join(site, "tool", "manual", "page.html"), "utf8")).toContain("A page of the guide");
  });

  it("names no folder of the machine in any text file", async () => {
    const needles = [repo.replace(/\/$/, ""), homedir(), tmpdir(), "/Volumes/", "/Users/", "/private/", "/home/"];
    const found: string[] = [];
    const files = await textFiles(site);
    expect(files.size).toBeGreaterThan(15);
    for (const [file, text] of files) for (const n of needles) if (text.includes(n)) found.push(`${file}: ${n}`);
    expect(found).toEqual([]);
  });
});
