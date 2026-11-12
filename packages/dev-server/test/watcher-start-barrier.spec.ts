// The start barrier (watch.ts, startBarrier): pd dev is ready only once every watched folder has reported a
// write, so an edit saved the moment it is ready is handled. On macOS chokidar reports `ready` before its
// watches are live, and without the barrier such an edit can go unreported: the page never updates. Linux
// reports it either way, so there this spec guards the outcome, not the race.
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
  it("an edit in each watched folder, saved the moment pd dev is ready, is handled and reloads", async () => {
    const b = new Bench(await project(), "atoms/btn");
    await b.start(config);
    // No wait of any kind between ready and the edits.
    const from = handled.length;
    const messagesFrom = b.messages.length;
    const edits = Object.keys(FILES);
    for (const rel of edits) await b.edit(rel, rel.endsWith(".hbs") ? "<p>two</p>\n" : rel.endsWith(".txt") ? "two\n" : "\n/* two */\n");
    const onDisk = new Map(await Promise.all(edits.map(async rel => [rel, await diskStamp(b.at(rel))] as const)));
    const stampsOf = (rel: string) => handled.slice(from).filter(h => b.owns(h.path) && b.rel(h.path) === rel).map(h => h.stamp);
    await whenHandled(() => edits.every(rel => isSettled(stampsOf(rel), onDisk.get(rel)!)),
      () => `each edit handled as it is on disk; handled: ${JSON.stringify(b.handledSince(from))}`);
    await b.barrier();
    const sent = b.messages.slice(messagesFrom);
    expect(sent).toContain("{\"type\":\"content-swap\",\"componentId\":\"atoms/btn\"}");
    expect(sent.some(m => m.includes("\"type\":\"css-link-swap\"") && m.includes("atoms/btn"))).toBe(true);
    await b.close();
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
