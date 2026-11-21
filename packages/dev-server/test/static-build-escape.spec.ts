// pd build writes only inside its output folder. An encoded slash (`%2f`) is no separator to a URL, so a
// reference like the one below passes every URL normalisation as a single segment; decoded for the disk, it
// climbs out. A component's template is the way in: the workbench build captures every reference its preview
// makes, and the component stylesheet route used to answer 200 for any name.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { buildStaticSite, type StaticBuildReport } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

// From the staging folder beside the output (<tmp>/site.pd-build-…), four levels up is <tmp>.
const ESCAPE = "/_pd/components/x%2f..%2f..%2f..%2f..%2fevil.css";
let tmp = "";
let report: StaticBuildReport;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-build-escape-"));
  const project = join(tmp, "project");
  await mkdir(join(project, "src", "patterns", "thing"), { recursive: true });
  await mkdir(join(project, "src", "styles"), { recursive: true });
  await save(join(project, "src", "patterns", "thing", "thing.hbs"), `<link rel="stylesheet" href="${ESCAPE}"><p>the thing</p>`);
  const config = defineConfig({ sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { dir: "./src/styles" } });
  report = await buildStaticSite(config, project, { outDir: join(tmp, "site"), pdVersion: "0.0.0-test", audit: false });
}, 120_000);

afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("pd build — a reference whose encoded slashes lead out of the output folder", () => {
  it("writes nothing outside the output folder", async () => {
    const written = (await readdir(tmp, { recursive: true })).filter(f => f.endsWith("evil.css"));
    expect(written).toEqual([]);
  });

  it("reports the reference as missing, as any reference to a file the server doesn't have", () => {
    expect(report.warnings).toContain(`404 ${ESCAPE}`);
  });
});
