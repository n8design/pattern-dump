// chokidar's own behaviour that watch.ts relies on, pinned so an upgrade that changes it turns red. These cases
// watch with chokidar directly, without pd dev.
//
// - A second change right after one was reported is reported too. chokidar 3.6 dropped a change to a path within
//   50 ms of the last one it reported; chokidar 6 holds it and reports it when its window ends. watch.ts still
//   looks at a changed file again after CHANGE_RECHECK_MS.
// - A file saved into a folder made a moment before is reported. chokidar 3.6 read a new folder before it
//   watched it, so such a file could go unreported; chokidar 6 watches first. watch.ts still rescans a new
//   folder for now.
// - chokidar 6 keeps none of 3.6's private state that watch.ts read (`_closers`, its fsevents flag), so its
//   rescan runs on its fallback times.
// - One file watched (the config file) costs a watch on its folder (and on macOS one on the file too), none of
//   them recursive. Writes deeper in the project are never reported, and reach its callbacks at most as a few
//   coalesced notices naming the folder they are in (macOS: 3 for 200 writes), never one per write.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { realpathSync, watch as fsWatch, type FSWatcher as NodeWatcher, type WatchListener } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import chokidar, { type FSWatcher } from "chokidar";
import { chokidarBackend, chokidarWatches } from "../src/watch.js";
import { save, saveInTwoSteps } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = realpathSync(await mkdtemp(join(tmpdir(), "pd-chokidar-"))); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

/** A watcher on `dir` with the options watch.ts uses, ready, and every event it reports. */
async function watching(dir: string): Promise<{ w: FSWatcher; events: Array<{ event: string; path: string; at: number }> }> {
  const w = chokidar.watch(dir, { ignoreInitial: true, persistent: true });
  const events: Array<{ event: string; path: string; at: number }> = [];
  w.on("all", (event: string, path: string) => events.push({ event, path, at: Date.now() }));
  await new Promise<void>(resolve => w.once("ready", () => resolve()));
  return { w, events };
}
/** Until `test` holds, checked every few ms; fails after 5 s, saying what was waited for and what came. */
async function until(test: () => boolean, what: () => string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`not within 5 s: ${what()}`);
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

describe("chokidar 6, as watch.ts uses it", () => {
  it("reports a second change made right after the first was reported", async () => {
    const dir = join(tmp, "quick");
    const file = join(dir, "quick.txt");
    await save(file, "0");
    const { w, events } = await watching(dir);
    try {
      const changes = () => events.filter(e => e.event === "change" && e.path === file);
      await saveInTwoSteps(file, "1");
      await until(() => changes().length >= 1, () => `the first change; events: ${JSON.stringify(events)}`);
      const secondAt = Date.now();
      // At once, as an editor's format-on-save writes again.
      await saveInTwoSteps(file, "2");
      await until(() => changes().some(e => e.at >= secondAt), () => `a change after the second save; events: ${JSON.stringify(events)}`);
    } finally {
      await w.close();
    }
  });

  it("reports a file saved into a folder made a moment before, each time", async () => {
    const root = join(tmp, "folders");
    await mkdir(root);
    const { w, events } = await watching(root);
    try {
      for (let i = 0; i < 10; i++) {
        const file = join(root, `new-${i}`, `item-${i}.hbs`);
        await mkdir(dirname(file));
        await save(file, `<p>${i}</p>\n`);
        await until(() => events.some(e => e.event === "add" && e.path === file), () => `the add of ${file}; events: ${JSON.stringify(events)}`);
      }
    } finally {
      await w.close();
    }
  });

  it("keeps none of chokidar 3.6's private state that watch.ts reads", async () => {
    const { w } = await watching(tmp);
    try {
      expect(chokidarWatches(w, [tmp])).toBeNull();
      expect(chokidarBackend(w)).toBeNull();
    } finally {
      await w.close();
    }
  });
});

describe("one file watched, as the config file is", () => {
  // chokidar's own test hooks, from its backend: every watch it opens goes through them.
  const backendPath = join(dirname(createRequire(import.meta.url).resolve("chokidar")), "backend.js");
  type Factory = (path: string, options: { recursive?: boolean }, listener: WatchListener<string>) => NodeWatcher;
  let backend: { setNativeWatchFactoryForTests(f?: Factory): void; setRecursiveWatchFactoryForTests(f?: Factory): void };
  const opened: Array<{ path: string; recursive: boolean }> = [];
  /** The name each callback from the OS carried, from every watch opened. */
  let heard: Array<string | null> = [];
  const factory: Factory = (path, options, listener) => {
    opened.push({ path, recursive: options.recursive === true });
    return fsWatch(path, options, (event, name) => { heard.push(name === null ? null : String(name)); listener(event, name); });
  };
  beforeAll(async () => {
    backend = await import(pathToFileURL(backendPath).href) as typeof backend;
    backend.setNativeWatchFactoryForTests(factory);
    backend.setRecursiveWatchFactoryForTests(factory);
  });
  afterAll(() => {
    backend.setNativeWatchFactoryForTests();
    backend.setRecursiveWatchFactoryForTests();
  });

  it("watches its folder (and maybe the file), nothing recursively, and reports nothing of writes deeper in it", async () => {
    const root = join(tmp, "project");
    const config = join(root, "pattern-dump.config.ts");
    await save(config, "export default {};\n");
    await mkdir(join(root, "dist", "deep"), { recursive: true });
    const w = chokidar.watch(config, { ignoreInitial: true, persistent: true });
    const changed: string[] = [];
    w.on("change", (path: string) => changed.push(path));
    try {
      await new Promise<void>(resolve => w.once("ready", () => resolve()));
      // Its folder, on every platform; the file as well on macOS. Nothing else, and nothing recursive.
      const shown = opened.map(o => ({ ...o, path: o.path === root ? "<folder>" : o.path === config ? "<file>" : o.path }));
      expect(shown).toContainEqual({ path: "<folder>", recursive: false });
      expect(shown.filter(o => o.path !== "<folder>" && !(o.path === "<file>" && !o.recursive))).toEqual([]);
      expect(shown.every(o => !o.recursive)).toBe(true);
      heard = [];
      const WRITES = 200;
      for (let i = 0; i < WRITES; i++) await save(join(root, "dist", "deep", `out-${i}.js`), `${i}`);
      // Then the config file, and once it is reported, nothing of the writes before it has come either.
      await save(config, "export default { a: 1 };\n");
      await until(() => changed.includes(config), () => `the config file's change; changes: ${JSON.stringify(changed)}`);
      expect(changed).toEqual([config]);
      // Not one callback per write: what reaches them of the writes is coalesced, if anything does.
      expect(heard.length, `callbacks: ${JSON.stringify(heard)}`).toBeLessThan(WRITES / 10);
    } finally {
      await w.close();
    }
  });
});
