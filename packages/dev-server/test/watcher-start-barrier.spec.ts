// The start barrier (watch.ts, startBarrier): pd dev is ready only once every watched folder has reported a
// write, so an edit saved the moment it is ready is handled. chokidar's `ready` means its first scan is done, not
// that its watches are live: on macOS an edit in the first moment after it can go unreported. That race is
// under a millisecond wide, so a test cannot rely on hitting it. These cases hold the barrier to its contract
// instead: a test-only hook keeps one folder's watch from going live until a while after `ready`, on every
// platform, and pd dev must not be ready before that folder has reported.
//
// Also: the barrier leaves nothing behind, removes one a crash left, and a folder it cannot write to is
// named and skipped, with pd dev started all the same.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { Bench, closeAll, diskStamp, handled, isSettled, whenHandled } from "./watch-harness.js";
import { startOnFreeWsPort } from "./free-ports.js";
import { save } from "../../../test-support/save.js";

const START_FILE = ".pd-watch-start";
/** How long after chokidar's ready the late folder's watch goes live: well under the barrier's 2 s fallback. */
const LATE_MS = 300;
const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  assets: { strategy: "central", dir: "./assets" },
  scriptsDir: "./src/scripts",
}), "site");
/** One existing file in each of four watched folders. */
const FILES = {
  "src/patterns/atoms/btn/btn.hbs": "<button class=\"btn\">One</button>\n",
  "src/styles/01-atoms/btn.scss": ".btn { color: red; }\n",
  "src/scripts/tool.ts": "export const tool = 1;\n",
  "assets/note.txt": "one\n",
};

let tmp = "";
let n = 0;
async function project(): Promise<string> {
  const root = join(tmp, `site-${n++}`);
  for (const [rel, text] of Object.entries(FILES)) await save(join(root, rel), text);
  return root;
}
/** Every START_FILE under `root`, wherever it is. */
async function startFilesIn(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.name === START_FILE) found.push(join(entry.parentPath, entry.name));
  }
  return found;
}

beforeAll(async () => { tmp = realpathSync(await mkdtemp(join(tmpdir(), "pd-start-barrier-"))); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("the start barrier", () => {
  it("is ready only once a folder whose watch goes live late has reported, and an edit saved then is handled", async () => {
    const root = await project();
    // The patterns folder's watch goes live LATE_MS after chokidar's ready; until then its events are dropped.
    const late: { dir: string; ms: number; liveAt?: number } = { dir: join(root, "src/patterns"), ms: LATE_MS };
    (globalThis as { __testOnly_liveAfterReady?: typeof late }).__testOnly_liveAfterReady = late;
    const readyLineAt: number[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      if (String(args[0]).startsWith("[dev-server] Ready in ")) readyLineAt.push(Date.now());
    });
    try {
      const { server } = await startOnFreeWsPort(config, root);
      const startedAt = Date.now();
      try {
        // No wait of any kind between ready and the edit.
        const file = join(root, "src/patterns/atoms/btn/btn.hbs");
        const from = handled.length;
        await save(file, "<p>two</p>\n");
        const onDisk = await diskStamp(file);
        expect(late.liveAt, "the hook was armed at chokidar's ready").toBeTypeOf("number");
        expect.soft(readyLineAt, "one Ready line").toHaveLength(1);
        expect.soft(readyLineAt[0], "the Ready line, against the folder going live").toBeGreaterThanOrEqual(late.liveAt!);
        expect.soft(startedAt, "the start promise, against the folder going live").toBeGreaterThanOrEqual(late.liveAt!);
        const stamps = () => handled.slice(from).filter(h => h.path === file).map(h => h.stamp);
        await whenHandled(() => isSettled(stamps(), onDisk),
          () => `the edit saved once pd dev was ready; handled: ${JSON.stringify(handled.slice(from).map(h => [h.event, h.path]))}`);
      } finally {
        await server.close();
      }
    } finally {
      delete (globalThis as { __testOnly_liveAfterReady?: typeof late }).__testOnly_liveAfterReady;
    }
  }, 30_000);

  it("leaves nothing behind, and removes one a crash left", async () => {
    const root = await project();
    // As a pd dev that crashed during its barrier left it.
    await save(join(root, "src/patterns", START_FILE), "..");
    const b = new Bench(root, "atoms/btn");
    await b.start(config);
    expect(await startFilesIn(root)).toEqual([]);
    await b.close();
    expect(await startFilesIn(root)).toEqual([]);
  }, 30_000);

  // Without the harness's Bench, which writes its own barrier into every watched folder before it starts.
  it.skipIf(process.getuid?.() === 0)("names a folder it cannot write to, skips it, and starts", async () => {
    const root = await project();
    const locked = join(root, "assets");
    await chmod(locked, 0o555);
    const warn = vi.spyOn(console, "warn");
    try {
      const { server } = await startOnFreeWsPort(config, root);
      try {
        const said = warn.mock.calls.map(c => c.join(" ")).filter(l => l.includes("Cannot write to"));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain("assets");
        expect((await fetch(`http://127.0.0.1:${server.port}/api/tree`)).status).toBe(200);
        expect(await startFilesIn(root)).toEqual([]);
      } finally {
        await server.close();
      }
    } finally {
      await chmod(locked, 0o755);
    }
  }, 30_000);
});
