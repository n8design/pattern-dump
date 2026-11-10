// chokidar's own behaviour that watch.ts works around, pinned so an upgrade that changes it turns red.
// chokidar drops a `change` to a path within 50 ms of the previous one and never reports it later
// (`_throttle(EV_CHANGE, path, 50)` in its `_emit`). watch.ts looks at a changed file again after
// CHANGE_RECHECK_MS, which must stay outside that window.
//
// Linux only: there events arrive within milliseconds, so a second save can land in the window. With
// macOS's fsevents they arrive about 100 ms after the write, outside it, and the drop cannot be produced
// through the file system. Even on Linux a loaded machine can be slower than the window, so the drop case
// measures each attempt and retries one whose second save landed outside it (bounded; it never passes
// without having tested the drop).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { CHANGE_RECHECK_MS, chokidarBackend, chokidarWatches } from "../src/watch.js";
import { save, saveInTwoSteps } from "../../../test-support/save.js";

let tmp = "";
let watcher: FSWatcher;
/** When chokidar reported each change, by file. */
const changes = new Map<string, number[]>();
/** chokidar's window: a change to a path within this long of the last one it reported is dropped. */
const WINDOW_MS = 50;
/** How many attempts the drop case makes before it gives up, saying it could not test the drop. */
const ATTEMPTS = 10;

/** A file of the case's own, saved in place, grown by one character each time. */
function track(name: string) {
  const file = join(tmp, name);
  let text = "";
  const seen = (): number[] => changes.get(file) ?? [];
  return {
    file,
    /** Save once more; resolves when the write is done. */
    save: () => saveInTwoSteps(file, text += "x"),
    seen,
    /** Resolve with when a change after the `from`-th is reported, or null if none is within `ms`. */
    reported: (from: number, ms: number): Promise<number | null> => new Promise(resolve => {
      const timer = setInterval(() => { if (seen().length > from) { clearInterval(timer); clearTimeout(out); resolve(seen()[from]!); } }, 2);
      const out = setTimeout(() => { clearInterval(timer); resolve(seen().length > from ? seen()[from]! : null); }, ms);
    }),
  };
}

beforeAll(async () => {
  tmp = realpathSync(await mkdtemp(join(tmpdir(), "pd-chokidar-")));
  for (const name of ["drop.txt", "recheck.txt"]) await save(join(tmp, name), "");
  // The options watch.ts uses.
  watcher = chokidar.watch(tmp, { ignoreInitial: true, persistent: true });
  watcher.on("change", (path: string) => { changes.set(path, [...(changes.get(path) ?? []), Date.now()]); });
  await new Promise<void>(resolve => watcher.once("ready", () => resolve()));
});
afterAll(async () => {
  await watcher?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe.runIf(process.platform === "linux")("chokidar's change window (Linux)", () => {
  it("drops a change to the same file made right after the previous one was reported, and never reports it", async () => {
    const f = track("drop.txt");
    const tried: string[] = [];
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      // Each attempt starts outside the last report's window, so its first save is reported.
      const last = f.seen().at(-1);
      if (last !== undefined) await new Promise(resolve => setTimeout(resolve, Math.max(0, last + 2 * WINDOW_MS - Date.now())));
      const from = f.seen().length;
      const first = f.reported(from, 1_000);
      await f.save();
      const firstAt = await first;
      expect(firstAt, `attempt ${attempt}: the first save is reported`).not.toBeNull();
      // At once, as an editor's format-on-save writes again.
      await f.save();
      const savedAfter = Date.now() - firstAt!;
      const secondAt = await f.reported(from + 1, 500);
      if (secondAt !== null) {
        // Reported: inside the window, the drop failed; after it, this attempt could not test the drop.
        expect(secondAt - firstAt!, `attempt ${attempt}: a change ${secondAt - firstAt!} ms after the last report, inside chokidar's ${WINDOW_MS} ms window, was reported`).toBeGreaterThanOrEqual(WINDOW_MS);
        tried.push(`reported ${secondAt - firstAt!} ms after the first`);
        continue;
      }
      // Not reported: the drop, if the save landed inside the window.
      if (savedAfter < WINDOW_MS) return;
      tried.push(`saved ${savedAfter} ms after the first, not reported`);
    }
    throw new Error(`the drop could not be tested: no second save landed inside chokidar's ${WINDOW_MS} ms window in ${ATTEMPTS} attempts (${tried.join("; ")})`);
  }, 30_000);

  it("reports a change made once CHANGE_RECHECK_MS has passed since the previous one", async () => {
    // A file of its own: chokidar's window is per path, so nothing the case above did can reach it.
    const f = track("recheck.txt");
    const firstAt = f.reported(0, 1_000);
    await f.save();
    expect(await firstAt).not.toBeNull();
    await new Promise(resolve => setTimeout(resolve, CHANGE_RECHECK_MS));
    const next = f.reported(1, 1_000);
    await f.save();
    expect(await next).not.toBeNull();
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
