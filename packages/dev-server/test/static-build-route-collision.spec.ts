// A shell route whose file a capture already wrote is not written over, and the build says so.
//
// It happens when a pattern folder shares its name with one of PD's own URL prefixes. Here a top-level
// component `thing` (thing/thing.hbs; a .hbs loose at the patterns root is not a component) and a folder
// `preview/` holding `preview/thing`: the workbench route of `preview/thing` is /preview/thing, which is
// also the server URL of the preview of `thing`, so both map to preview/thing/index.html.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { buildStaticSite, type StaticBuildReport } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let tmp = "";
let report: StaticBuildReport;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-route-collision-"));
  const project = join(tmp, "project");
  await mkdir(join(project, "src", "patterns", "preview"), { recursive: true });
  await mkdir(join(project, "src", "patterns", "thing"), { recursive: true });
  await mkdir(join(project, "src", "styles"), { recursive: true });
  await save(join(project, "src", "patterns", "thing", "thing.hbs"), `<p class="thing">the thing</p>`);
  await save(join(project, "src", "patterns", "preview", "thing.hbs"), `<p class="other">another thing</p>`);
  const config = defineConfig({ sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { dir: "./src/styles" } });
  report = await buildStaticSite(config, project, { outDir: join(tmp, "site"), pdVersion: "0.0.0-test", audit: false });
}, 120_000);

afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("pd build — a shell route whose file is already written", () => {
  it("warns, naming the route, the file and what wrote it", () => {
    expect(report.warnings).toEqual([
      "shell page for route /preview/thing not written: preview/thing/index.html already holds the server's response to /preview/thing",
    ]);
  });

  it("keeps the file it would have overwritten: the preview document of `thing`", async () => {
    const file = await readFile(join(tmp, "site", "preview", "thing", "index.html"), "utf8");
    expect(file).toContain(`<p class="thing">the thing</p>`);
    expect(file).not.toContain(`id="app"`);
  });

  it("still writes the shell for every route that does not collide", async () => {
    expect(await readFile(join(tmp, "site", "thing", "index.html"), "utf8")).toContain(`id="app"`);
    expect(await readFile(join(tmp, "site", "index.html"), "utf8")).toContain(`id="app"`);
  });
});
