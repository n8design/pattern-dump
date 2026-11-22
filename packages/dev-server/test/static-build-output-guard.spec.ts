// pd build empties its output folders and puts the new build in their place, so neither may be, or hold, or sit
// inside anything the build reads: every input the build stamps (patterns, styles, data, helpers, scripts, themes,
// assets, the pages and the site's head file). A slip of the path (`--out src/_data`) must be refused before
// anything is written, naming what it would have hit, and leave that input as it was.
// Each case runs on a copy of the storefront bench with a data folder, a helpers file and a head file added.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig, type SiteConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const DATA = `{"guard":"kept"}`;
const HELPERS = `export default function (hb) { hb.registerHelper("guardKept", () => "kept"); }\n`;
const HEAD = `<meta name="guard" content="kept">\n`;
let tmp = "";

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-output-guard-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
async function benchCopy(): Promise<string> {
  const root = join(tmp, `bench-${n++}`);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  await save(join(root, "src", "_data", "guard.json"), DATA);
  await save(join(root, "src", "helpers.mjs"), HELPERS);
  await save(join(root, "head.hbs"), HEAD);
  return root;
}
const config = (site: Partial<SiteConfig> = {}): PatternDumpConfig => validateConfig({
  ...benchConfig, dataDir: "./src/_data", helpers: "./src/helpers.mjs",
  site: { ...benchConfig.site!, head: "./head.hbs", ...site },
}, "test");
const build = (root: string, out: string, cfg: PatternDumpConfig = config()) =>
  buildStaticSite(cfg, root, { outDir: out, pdVersion: "0.0.0-test" });

/** Every input the bench copy was given is still there, as written. */
async function inputsKept(root: string): Promise<void> {
  expect(await readFile(join(root, "src", "_data", "guard.json"), "utf8")).toBe(DATA);
  expect(await readFile(join(root, "src", "helpers.mjs"), "utf8")).toBe(HELPERS);
  expect(await readFile(join(root, "head.hbs"), "utf8")).toBe(HEAD);
  expect((await readFile(join(root, "src", "scripts", "header-ready.ts"), "utf8")).length).toBeGreaterThan(0);
  expect((await readFile(join(root, "pages", "about.md"), "utf8")).length).toBeGreaterThan(0);
}

describe("pd build — an output folder on an input", () => {
  const cases: Array<[kind: string, path: (root: string) => string]> = [
    ["the data folder", root => join(root, "src", "_data")],
    ["the scripts folder", root => join(root, "src", "scripts")],
    ["the helpers file", root => join(root, "src", "helpers.mjs")],
    ["the site's head file", root => join(root, "head.hbs")],
    ["the pages folder", root => join(root, "pages")],
  ];

  for (const [kind, path] of cases) {
    it(`refuses --out on ${kind}, and leaves it as it was`, async () => {
      const root = await benchCopy();
      const out = path(root);
      await expect(build(root, out)).rejects.toThrow(
        `pd build: --out ${out} overlaps ${kind} ${out}, which Pattern Dump reads: choose another folder`);
      await inputsKept(root);
    }, 120_000);
  }

  it("refuses --out inside the data folder, naming the folder", async () => {
    const root = await benchCopy();
    const out = join(root, "src", "_data", "out");
    await expect(build(root, out)).rejects.toThrow(
      `pd build: --out ${out} overlaps the data folder ${join(root, "src", "_data")}, which Pattern Dump reads`);
    await inputsKept(root);
  }, 120_000);

  const siteCases: Array<[kind: string, outDir: string, path: (root: string) => string]> = [
    ["the data folder", "./src/_data", root => join(root, "src", "_data")],
    ["the scripts folder", "./src/scripts", root => join(root, "src", "scripts")],
    ["the helpers file", "./src/helpers.mjs", root => join(root, "src", "helpers.mjs")],
    ["the site's head file", "./head.hbs", root => join(root, "head.hbs")],
  ];

  for (const [kind, outDir, path] of siteCases) {
    it(`refuses site.outDir on ${kind}, and leaves it as it was`, async () => {
      const root = await benchCopy();
      await expect(build(root, join(root, "..", `wb-${n}`), config({ outDir }))).rejects.toThrow(
        `pd build: site.outDir ${path(root)} overlaps ${kind} ${path(root)}, which Pattern Dump reads: choose another folder`);
      await inputsKept(root);
    }, 120_000);
  }
});
