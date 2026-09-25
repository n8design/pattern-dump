// `pd build` copies assets as `pd dev` serves them: `/assets/<name>/…` comes from the FIRST root with
// that folder name, so a later root of the same name is left out (and reported), never copied over
// the first one's files.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { buildStaticSite, type StaticBuildReport } from "@pattern-dump/dev-server";
import { shadowedAssetRoots } from "../src/server-config.js";

let tmp = "";
let site = "";
let report: StaticBuildReport;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-static-assets-"));
  const project = join(tmp, "project");
  site = join(tmp, "site");
  const files: Record<string, string> = {
    "src/patterns/atoms/dot/dot.hbs": `<span class="dot">dot</span>\n`,
    "src/styles/01-atoms/dot.scss": `.dot { color: red; }\n`,
    "assets/icons.svg": "project icons",
    "vendor/assets/icons.svg": "vendor icons",
    "vendor/assets/vendor-only.svg": "vendor only",
  };
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(project, rel)), { recursive: true });
    await writeFile(join(project, rel), text);
  }
  const config = defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    assets: { strategy: "central", dir: ["./assets", "./vendor/assets"] },
  });
  report = await buildStaticSite(config, project, { outDir: site, basePath: "/", pdVersion: "0.0.0-test" });
}, 120_000);

afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("shadowedAssetRoots", () => {
  it("names every later root whose folder name an earlier root already has", () => {
    expect(shadowedAssetRoots(["/p/assets", "/v/assets", "/v/images", "/w/assets"])).toEqual([
      { root: "/v/assets", by: "/p/assets" },
      { root: "/w/assets", by: "/p/assets" },
    ]);
    expect(shadowedAssetRoots(["/p/assets", "/v/images"])).toEqual([]);
  });
});

describe("pd build — two asset roots with the same folder name", () => {
  it("keeps the first root's file where both have one", async () => {
    expect(await readFile(join(site, "assets/assets/icons.svg"), "utf-8")).toBe("project icons");
  });

  it("leaves the hidden root out entirely, as pd dev never serves it", async () => {
    await expect(stat(join(site, "assets/assets/vendor-only.svg"))).rejects.toThrow();
  });

  it("reports the hidden root", () => {
    expect(report.warnings.some(w => w.includes("vendor/assets") && w.includes("hidden"))).toBe(true);
  });
});
