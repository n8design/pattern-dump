// A build that fails anywhere after its server started closes the server (CR-003): a caller in one process (a test,
// a script) is left with no listening server and its staging folder gone. Forced with the build's own logger,
// which runs right after the server is ready and is one of the steps that used to close nothing. The servers are
// counted as this thread's listening handles (each test file runs in a thread of its own).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let tmp = "";
let project = "";
const listening = (): number => process.getActiveResourcesInfo().filter(r => r === "TCPServerWrap").length;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-build-close-"));
  project = join(tmp, "project");
  await mkdir(join(project, "src", "patterns", "thing"), { recursive: true });
  await mkdir(join(project, "src", "styles"), { recursive: true });
  await save(join(project, "src", "patterns", "thing", "thing.hbs"), `<p>the thing</p>`);
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("pd build that fails after its server started", () => {
  it("rejects, and leaves no server listening and no staging folder", async () => {
    const config = defineConfig({ sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { dir: "./src/styles" } });
    const before = listening();
    let during = -1;
    const log = (line: string): void => {
      if (line.startsWith("… server ready")) { during = listening(); throw new Error("the log broke, for a test"); }
    };
    await expect(buildStaticSite(config, project, { outDir: join(tmp, "site"), pdVersion: "0.0.0-test", audit: false, log }))
      .rejects.toThrow("the log broke, for a test");
    expect(during).toBe(before + 1);
    expect(listening()).toBe(before);
    expect((await readdir(tmp)).sort()).toEqual(["project"]);
  }, 120_000);
});
