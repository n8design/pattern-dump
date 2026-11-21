// The scratch folder holds what pd dev and pd audit derive (the diagnostics graph and its reports), and a cached
// audit is trusted from it. In the shared temp folder another user could create it first, plant a link in it or
// write a clean audit into it, so it lives in the user's own cache folder, is created for the user only, and is
// checked before anything reads or writes it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRAPH_ARTIFACT_VERSION, graphArtifactPath, readDiagnosticsArtifact } from "../src/diagnostics.js";
import { ensureScratchDir, pdScratchDir, userCacheDir } from "../src/scratch.js";
import { save } from "../../../test-support/save.js";

const posix = process.platform !== "win32";
let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-scratch-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("the user's cache folder", () => {
  it("is where the scratch folder is: not in the shared temp folder", () => {
    expect(pdScratchDir("/some/project").startsWith(join(tmpdir(), "pattern-dump"))).toBe(false);
  });

  it("is the platform's per-user cache, never the shared temp folder", () => {
    expect(userCacheDir({}, "darwin", "/Users/u")).toBe(join("/Users/u", "Library", "Caches"));
    expect(userCacheDir({ XDG_CACHE_HOME: "/tmp/c" }, "darwin", "/Users/u")).toBe("/tmp/c");
    expect(userCacheDir({}, "linux", "/home/u")).toBe(join("/home/u", ".cache"));
    expect(userCacheDir({ XDG_CACHE_HOME: "/var/cache/u" }, "linux", "/home/u")).toBe("/var/cache/u");
    // A relative XDG_CACHE_HOME is invalid by the spec, and ignored.
    expect(userCacheDir({ XDG_CACHE_HOME: "cache" }, "linux", "/home/u")).toBe(join("/home/u", ".cache"));
    expect(userCacheDir({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u")).toBe("C:\\Users\\u\\AppData\\Local");
    expect(userCacheDir({}, "win32", "C:\\Users\\u")).toBe(join("C:\\Users\\u", "AppData", "Local"));
  });

  it("holds the scratch folder, keyed by the root as before", () => {
    const dir = pdScratchDir("/some/project");
    expect(dir.startsWith(join(userCacheDir(), "pattern-dump"))).toBe(true);
    expect(dir.startsWith(join(tmpdir(), "pattern-dump"))).toBe(false);
    expect(dir).toMatch(/[/\\]pattern-dump[/\\][0-9a-f]{16}$/);
    expect(pdScratchDir("/some/project", "/cache")).toBe(join("/cache", "pattern-dump", dir.slice(-16)));
  });
});

describe("ensureScratchDir", () => {
  it("creates the folder for the user only, and returns it", async () => {
    const cache = join(tmp, "fresh");
    const dir = await ensureScratchDir("/some/project", cache);
    expect(dir).toBe(pdScratchDir("/some/project", cache));
    const st = await lstat(dir);
    expect(st.isDirectory()).toBe(true);
    if (posix) {
      expect(st.mode & 0o777).toBe(0o700);
      expect((await lstat(join(cache, "pattern-dump"))).mode & 0o777).toBe(0o700);
    }
    // A second call finds it as it left it.
    expect(await ensureScratchDir("/some/project", cache)).toBe(dir);
  });

  it("refuses a scratch folder that is a link, naming it", async () => {
    const cache = join(tmp, "linked");
    const dir = pdScratchDir("/some/project", cache);
    await mkdir(join(cache, "pattern-dump"), { recursive: true, mode: 0o700 });
    await mkdir(join(tmp, "elsewhere"));
    await symlink(join(tmp, "elsewhere"), dir, "dir");
    await expect(ensureScratchDir("/some/project", cache)).rejects.toThrow(`pd: the scratch folder ${dir} is a link`);
  });

  it.runIf(posix)("refuses a scratch folder others may write to, naming it", async () => {
    const cache = join(tmp, "open");
    const dir = pdScratchDir("/some/project", cache);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o777);
    await expect(ensureScratchDir("/some/project", cache)).rejects.toThrow(`pd: the scratch folder ${dir} can be written by other users`);
    await chmod(join(cache, "pattern-dump"), 0o777);
    await chmod(dir, 0o700);
    await expect(ensureScratchDir("/some/project", cache)).rejects.toThrow(`pd: the scratch folder ${join(cache, "pattern-dump")} can be written by other users`);
  });
});

describe("a cached audit", () => {
  it.runIf(posix)("is reused only from a scratch folder that is this user's alone", async () => {
    const root = join(tmp, "project");
    const dir = await ensureScratchDir(root);
    try {
      const art = { version: GRAPH_ARTIFACT_VERSION, hashes: {}, graph: { components: [], occurrences: [] } };
      await save(graphArtifactPath(root), JSON.stringify(art));
      expect(await readDiagnosticsArtifact(root)).toEqual(art);
      // Others may write into it: the artifact is not read, and the audit runs in full.
      await chmod(dir, 0o777);
      expect(await readDiagnosticsArtifact(root)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
