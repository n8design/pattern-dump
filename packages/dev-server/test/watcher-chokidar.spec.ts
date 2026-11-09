// chokidar's own behaviour that watch.ts works around, pinned so an upgrade that changes it turns red.
// chokidar drops a `change` to a path within 50 ms of the previous one and never reports it later
// (`_throttle(EV_CHANGE, path, 50)` in its `_emit`). watch.ts looks at a changed file again after
// CHANGE_RECHECK_MS, which must stay outside that window.
//
// Linux only: there events arrive within milliseconds, so a second save can land in the window. With
// macOS's fsevents they arrive about 100 ms after the write, outside it, and the drop cannot be produced
// through the file system.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { CHANGE_RECHECK_MS, chokidarBackend, chokidarWatches } from "../src/watch.js";
import { save, saveInTwoSteps } from "../../../test-support/save.js";

let tmp = "";
let file = "";
/** The file's text: each change saves it in place, grown by one character. */
let text = "";
let watcher: FSWatcher;
const changes: number[] = [];

/** Resolve with whether a change to the file is reported within `ms`. */
const reported = (ms: number): Promise<boolean> => new Promise(resolve => {
  const from = changes.length;
  const timer = setInterval(() => { if (changes.length > from) { clearInterval(timer); resolve(true); } }, 2);
  setTimeout(() => { clearInterval(timer); resolve(changes.length > from); }, ms);
});

beforeAll(async () => {
  tmp = realpathSync(await mkdtemp(join(tmpdir(), "pd-chokidar-")));
  file = join(tmp, "f.txt");
  await save(file, text);
  // The options watch.ts uses.
  watcher = chokidar.watch(tmp, { ignoreInitial: true, persistent: true });
  watcher.on("change", () => changes.push(Date.now()));
  await new Promise<void>(resolve => watcher.once("ready", () => resolve()));
});
afterAll(async () => {
  await watcher?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe.runIf(process.platform === "linux")("chokidar's change window (Linux)", () => {
  it("drops a change to the same file made right after the previous one was reported, and never reports it", async () => {
    const first = reported(1_000);
    await saveInTwoSteps(file, text += "1");
    expect(await first).toBe(true);
    // At once, inside the window.
    const second = reported(500);
    await saveInTwoSteps(file, text += "2");
    expect(await second).toBe(false);
  });

  it("reports a change made once CHANGE_RECHECK_MS has passed since the previous one", async () => {
    const first = reported(1_000);
    await saveInTwoSteps(file, text += "3");
    expect(await first).toBe(true);
    await new Promise(resolve => setTimeout(resolve, CHANGE_RECHECK_MS));
    const next = reported(1_000);
    await saveInTwoSteps(file, text += "4");
    expect(await next).toBe(true);
  });
});

// A new folder: chokidar (nodefs-handler.js, `_handleDir`) emits its `addDir` (551), reads it once (563) and
// only then watches it (567); `_addToNodeFs` records the watch in `_closers` once `_handleDir` has returned
// (`_addPathCloser`). A file that lands after the read and before the watch is never reported. watch.ts
// rescans a new folder until `_closers` has it (`chokidarWatches`); these cases pin what that relies on.
// On Linux it is the watcher watch.ts gets; on macOS it is asked for, and fsevents is pinned below.
describe("chokidar's own watcher, on a new folder", () => {
  let root = "";
  let w: FSWatcher;
  const events: Array<{ event: string; path: string; watched: boolean }> = [];
  const closers = (): Map<string, unknown> => (w as unknown as { _closers: Map<string, unknown> })._closers;
  beforeAll(async () => {
    root = realpathSync(await mkdtemp(join(tmpdir(), "pd-chokidar-dir-")));
    // The options watch.ts uses, with chokidar's own watcher, which it uses everywhere but with fsevents.
    w = chokidar.watch(root, { ignoreInitial: true, persistent: true, useFsEvents: false });
    w.on("all", (event: string, path: string) => events.push({ event, path, watched: closers().has(path) }));
    await new Promise<void>(resolve => w.once("ready", () => resolve()));
  });
  afterAll(async () => {
    await w?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  const until = async (test: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!test()) {
      if (Date.now() > deadline) throw new Error(`not within 5 s: ${what}; events: ${JSON.stringify(events)}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };

  it("has a Map of watches with an entry for the watched folder, which chokidarWatches reads", () => {
    expect(closers()).toBeInstanceOf(Map);
    expect(closers().has(root)).toBe(true);
    expect(chokidarWatches(w, [root])).toBe(closers());
    // Not as expected: no Map, or a watched folder missing from it.
    expect(chokidarWatches({} as FSWatcher, [root])).toBeNull();
    expect(chokidarWatches(w, [root, tmp])).toBeNull();
  });

  it("reports a new folder before it watches it, then records the watch in _closers under the reported path", async () => {
    const dir = join(root, "fresh");
    await mkdir(dir);
    await until(() => events.some(e => e.event === "addDir" && e.path === dir), "addDir");
    expect(events.find(e => e.event === "addDir" && e.path === dir)!.watched).toBe(false);
    await until(() => closers().has(dir), "_closers has the folder");
  });

  it("reports a file saved into the folder once _closers has it", async () => {
    const dir = join(root, "fresh-2");
    await mkdir(dir);
    await until(() => closers().has(dir), "_closers has the folder");
    const file = join(dir, "a.hbs");
    await save(file, "<p>a</p>\n");
    await until(() => events.some(e => e.event === "add" && e.path === file), "add of the file");
  });
});

// Which watcher chokidar uses, as watch.ts reads it at startup (`chokidarBackend`): with fsevents nothing is
// rescanned, with anything else every new folder is. fsevents is installed with the repo on macOS.
describe("which watcher chokidar uses", () => {
  const backendOf = async (options: { useFsEvents?: boolean }): Promise<string | null> => {
    const probe = chokidar.watch(tmp, { ignoreInitial: true, persistent: true, ...options });
    try { return chokidarBackend(probe); } finally { await probe.close(); }
  };
  it("is fsevents on macOS and its own elsewhere, with the options watch.ts uses", async () => {
    expect(await backendOf({})).toBe(process.platform === "darwin" ? "fsevents" : "nodefs");
  });
  it("is its own when fsevents is not to be used", async () => {
    expect(await backendOf({ useFsEvents: false })).toBe("nodefs");
  });
  it("is unknown when its flag and its handler disagree", () => {
    expect(chokidarBackend({ options: { useFsEvents: true }, _nodeFsHandler: {} } as unknown as FSWatcher)).toBeNull();
    expect(chokidarBackend({ options: {} } as unknown as FSWatcher)).toBeNull();
  });
});
