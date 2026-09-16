import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { detectLocalBuild } from "./local-build.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function file(path: string, when?: Date): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "");
  if (when) await utimes(path, when, when);
}
const cliEntry = (repo: string) => pathToFileURL(join(repo, "packages/cli/dist/index.js")).href;

describe("detectLocalBuild", () => {
  it("is null for an installed package — no source checkout above the binary", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-local-build-"));
    const bin = pathToFileURL(join(root, "node_modules/pattern-dump/dist/pd.js")).href;
    expect(detectLocalBuild(bin, "pattern-dump", "0.1.0")).toBeNull();
  });

  it("finds the checkout and reports a missing tarball", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-local-build-"));
    await file(join(root, "packages/cli/src/distribution.ts"));
    expect(detectLocalBuild(cliEntry(root), "pattern-dump", "0.1.0")).toEqual({ repo: root, tarball: null, stale: false });
  });

  it("returns the tarball, stale only when a built bundle is newer", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-local-build-"));
    await file(join(root, "packages/cli/src/distribution.ts"));
    const tarball = join(root, ".pd-pack/pattern-dump-0.1.0.tgz");
    await file(join(root, "packages/dev-server/dist/index.js"), new Date("2026-01-01"));
    await file(tarball, new Date("2026-01-02"));
    expect(detectLocalBuild(cliEntry(root), "pattern-dump", "0.1.0")).toMatchObject({ tarball, stale: false });

    await file(join(root, "apps/dev-ui/dist/main.js"), new Date("2026-01-03"));
    expect(detectLocalBuild(cliEntry(root), "pattern-dump", "0.1.0")).toMatchObject({ tarball, stale: true });
  });
});
