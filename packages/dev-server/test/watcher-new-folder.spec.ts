// Folders that arrive, leave and come back, through the real watcher (watch.ts, NEW_FOLDER_CAP_MS): a folder
// renamed within the tree, renamed back (also with chokidar missing the removal), moved in from outside,
// removed and made again. Each must be handled every time it arrives, its files with it, and each file once,
// though a new folder's rescan and chokidar both report what is in it, and the tree must show it. An `add` of
// a file as its last handling saw it is skipped, unless an unlink, or a handled `addDir` of its folder, came
// between. A folder restored with its files reported as changes only is built into discovery again. Within a
// rescan cycle, chokidar's late add of a file the cycle already reported is not a second add, a folder in it
// queued before the cycle started is not reported again however slow the first scan, a write between the last
// scan and the watches is seen by the closing scan, and a folder still not watched at the cap is said so once. And with chokidar's `_closers` not readable, the fallback still sees a
// file in a new folder, saying so once.
//
// The repeat is delivered with `__testOnly_onWatchStarted`, a missed removal made with `__testOnly_dropEvent`,
// a cycle held or its watches shown with `__testOnly_cycleTick`, the queue backed up with
// `__testOnly_holdHandler`, and `_closers` hidden with
// `__testOnly_hideChokidarWatches`, so none of it depends on timing. The gap itself
// (a file renamed into a folder made a moment before, never reported) shows under load only: watcher.spec's
// new-component cases and watcher-characterization's are its reproduction.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import chokidar from "chokidar";
import { defineConfig } from "@pattern-dump/config";
import { Bench, closeAll, handled, LATCH_MS, whenHandled } from "./watch-harness.js";
import { chokidarBackend } from "../src/watch.js";
import { save } from "../../../test-support/save.js";

type Deliver = (event: "change" | "add", path: string) => void;
const hooks = globalThis as {
  __testOnly_onWatchStarted?: (deliver: Deliver, forget: (path: string) => void) => void;
  __testOnly_hideChokidarWatches?: boolean;
  __testOnly_watchStamp?: (path: string, stamp: string) => string;
  __testOnly_dropEvent?: (event: string, path: string) => boolean;
  __testOnly_onCycleEnded?: (dir: string, why: string) => void;
  __testOnly_cycleTick?: (dir: string, watching: boolean) => boolean | Promise<boolean>;
  __testOnly_holdHandler?: (event: string, path: string) => Promise<void> | undefined;
};

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});
const DOCS = "src/patterns/atoms/btn/btn.md";
const DEGRADED = "New-folder detection is degraded";
/** A component folder's files, relative to it. */
const FILES = { "item.hbs": "<p class=\"item\">{{label}}</p>\n", "item.json": "{\"label\":\"Item\"}\n", "item.md": "# Item\n" };

// Whether watch.ts rescans new folders here: with chokidar's own watcher, not with fsevents (one stream, no gap).
const probeDir = realpathSync(await mkdtemp(join(tmpdir(), "pd-new-folder-probe-")));
const probe = chokidar.watch(probeDir, { ignoreInitial: true, persistent: true });
const rescanning = chokidarBackend(probe) !== "fsevents";
await probe.close();
await rm(probeDir, { recursive: true, force: true });

// Rescan cycles ended, by folder, and why (`__testOnly_onCycleEnded`).
const cyclesEnded: string[] = [];
const endedWhy = new Map<string, string>();
hooks.__testOnly_onCycleEnded = (dir, why) => { cyclesEnded.push(dir); endedWhy.set(dir, why); };

let tmp = "";
let n = 0;
/** A fresh project with one component, open in the workbench; and its watcher's deliver and forget functions. */
async function project(): Promise<{ b: Bench; deliver: Deliver; forget: (path: string) => void }> {
  const root = join(tmp, `site-${n++}`);
  await save(join(root, "src/patterns/atoms/btn/btn.hbs"), `<button class="btn">One</button>\n`);
  await mkdir(join(root, "src/styles"), { recursive: true });
  let deliver: Deliver | undefined;
  let forget: ((path: string) => void) | undefined;
  hooks.__testOnly_onWatchStarted = (d, f) => { deliver = d; forget = f; };
  const b = new Bench(root, "atoms/btn");
  await b.start(config);
  delete hooks.__testOnly_onWatchStarted;
  if (!deliver || !forget) throw new Error("the watcher did not hand over its deliver and forget functions");
  return { b, deliver, forget };
}

/** The files of a component folder at `dir` with FILES. */
const filesOf = (dir: string): string[] => Object.keys(FILES).map(f => `${dir}/${f}`);
/**
 * Arrivals among handled events: each folder's addDir, and each file's add or change, as ["addDir" | "file",
 * path], sorted. chokidar reports a file of a folder that comes back to a path it knew as a change (its watch
 * of the file outlives the folder), so which of the two a file arrives as is chokidar's; that it is handled,
 * once, is pd dev's.
 */
const arrivalsIn = (events: string[][]): string[][] => events
  .filter(([e]) => e === "addDir" || e === "add" || e === "change")
  .map(([e, p]) => [e === "addDir" ? "addDir" : "file", p!]).sort();
const expectedArrivals = (dirs: string[], files: string[]): string[][] =>
  [...dirs.map(d => ["addDir", d]), ...files.map(f => ["file", f])].sort();
/** Act, wait until every folder in `dirs` and every file in `files` has arrived (and `also` is handled), and,
 *  where new folders are rescanned, until the rescan cycle of every folder in `cycles` has ended, so a scan late
 *  in it is in the step too; the step's arrivals. */
async function arrive(b: Bench, act: () => Promise<void>, dirs: string[], files: string[], also: string[][] = [], cycles: string[] = []): Promise<string[][]> {
  const want = expectedArrivals(dirs, files);
  const { events } = await b.step(async () => {
    const from = handled.length;
    const endedFrom = cyclesEnded.length;
    await act();
    await whenHandled(() => { const got = JSON.stringify(arrivalsIn(b.handledSince(from))); return want.every(w => got.includes(JSON.stringify(w))); },
      () => `arrived: ${JSON.stringify(want)}; handled: ${JSON.stringify(b.handledSince(from))}`);
    if (rescanning) await until(() => cycles.every(c => cyclesEnded.slice(endedFrom).includes(b.at(c))), `the rescan cycles of ${JSON.stringify(cycles)} ended`);
  }, also);
  return arrivalsIn(events);
}
/** Until `test` holds, checked every few ms, failing after the harness's latch time with `what`. */
async function until(test: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + LATCH_MS;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`not within ${LATCH_MS} ms: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
/** A component folder moved in complete from outside the watched tree, with a folder in it, to `M`: every folder
 *  and file in it handled once, through every scan of its rescan cycle, and in the tree. */
async function movedIn(b: Bench, M: string): Promise<void> {
  const outside = join(tmp, `outside-${n++}`, "zz-m");
  for (const [f, text] of Object.entries(FILES)) await save(join(outside, f), text);
  await save(join(outside, "sub", "sub-item.hbs"), "<p class=\"sub\">sub</p>\n");
  const dirs = [M, `${M}/sub`];
  const files = [...filesOf(M), `${M}/sub/sub-item.hbs`];
  expect(await arrive(b, () => rename(outside, b.at(M)), dirs, files, [], dirs)).toEqual(expectedArrivals(dirs, files));
  expect(await inTree(b, `${M.replace("src/patterns/", "")}/item`)).toBe(true);
  expect(await inTree(b, `${M.replace("src/patterns/", "")}/sub/sub-item`)).toBe(true);
}
const inTree = async (b: Bench, id: string): Promise<boolean> =>
  (await (await fetch(`${b.origin}/api/tree`)).text()).includes(`"path":"${id}"`);

/** A component folder with FILES at `dir`, in a step of its own; each folder and file handled once. */
async function component(b: Bench, dir: string): Promise<void> {
  const got = await arrive(b, async () => { for (const [f, text] of Object.entries(FILES)) await b.create(`${dir}/${f}`, text); }, [dir], filesOf(dir));
  expect(got).toEqual(expectedArrivals([dir], filesOf(dir)));
}

beforeAll(async () => { tmp = realpathSync(await mkdtemp(join(tmpdir(), "pd-new-folder-"))); });
afterEach(() => {
  delete hooks.__testOnly_watchStamp;
  delete hooks.__testOnly_hideChokidarWatches;
  delete hooks.__testOnly_dropEvent;
  delete hooks.__testOnly_cycleTick;
  delete hooks.__testOnly_holdHandler;
});
afterAll(async () => {
  delete hooks.__testOnly_onCycleEnded;
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("an add reported twice", () => {
  it("is handled once: the second report, of a file as the first left it, is skipped", async () => {
    const { b, deliver } = await project();
    try {
      const from = handled.length;
      const first = await b.step(() => b.create(DOCS, "# Btn\n"), [["add", DOCS]]);
      expect(first.events).toEqual([["add", DOCS]]);
      const path = handled.slice(from).find(h => b.owns(h.path) && b.rel(h.path) === DOCS)!.path;
      // The same file reported again, as a rescan and chokidar both report it.
      expect(await b.step(async () => { deliver("add", path); }, [])).toEqual({ messages: [], events: [] });
    } finally {
      await b.close();
    }
  }, 60_000);

  it("after an unlink, with the same stamp and the same content, is handled", async () => {
    const { b } = await project();
    try {
      // Every write of the file gets the same stamp, so only the unlink tells the second add from a repeat.
      hooks.__testOnly_watchStamp = (path, stamp) => (path.endsWith(DOCS) ? "same-stamp" : stamp);
      expect((await b.step(() => b.create(DOCS, "# Btn\n"), [["add", DOCS]])).events).toEqual([["add", DOCS]]);
      expect((await b.step(() => b.remove(DOCS), [["unlink", DOCS]])).events).toEqual([["unlink", DOCS]]);
      const again = await b.step(() => b.create(DOCS, "# Btn\n"), [["add", DOCS]]);
      expect(again.events).toEqual([["add", DOCS]]);
      expect(again.messages).toContain(`{"type":"content-swap","componentId":"atoms/btn"}`);
    } finally {
      await b.close();
    }
  }, 60_000);
});

describe("a folder that leaves and comes back", () => {
  const A = "src/patterns/atoms/zz-a";
  const B = "src/patterns/atoms/zz-b";

  it("renamed within the tree: the new folder and its files are handled, the old one leaves the tree", async () => {
    const { b } = await project();
    try {
      await component(b, A);
      expect(await inTree(b, "atoms/zz-a/item")).toBe(true);
      expect(await arrive(b, () => rename(b.at(A), b.at(B)), [B], filesOf(B), [["unlinkDir", A]]))
        .toEqual(expectedArrivals([B], filesOf(B)));
      expect(await inTree(b, "atoms/zz-b/item")).toBe(true);
      expect(await inTree(b, "atoms/zz-a/item")).toBe(false);
    } finally {
      await b.close();
    }
  }, 60_000);

  it("renamed back: the folder and its files are handled again", async () => {
    const { b } = await project();
    try {
      await component(b, A);
      await arrive(b, () => rename(b.at(A), b.at(B)), [B], filesOf(B), [["unlinkDir", A]]);
      expect(await arrive(b, () => rename(b.at(B), b.at(A)), [A], filesOf(A), [["unlinkDir", B]]))
        .toEqual(expectedArrivals([A], filesOf(A)));
      expect(await inTree(b, "atoms/zz-a/item")).toBe(true);
      expect(await inTree(b, "atoms/zz-b/item")).toBe(false);
    } finally {
      await b.close();
    }
  }, 60_000);

  it("renamed back after chokidar missed its removal: the folder and its files are handled again", async () => {
    const { b } = await project();
    try {
      await component(b, A);
      // The folder's unlinkDir and its files' unlinks, never reported.
      hooks.__testOnly_dropEvent = (event, path) => event.startsWith("unlink") && b.owns(path) && (b.rel(path) === A || b.rel(path).startsWith(`${A}/`));
      await arrive(b, () => rename(b.at(A), b.at(B)), [B], filesOf(B));
      delete hooks.__testOnly_dropEvent;
      expect(await arrive(b, () => rename(b.at(B), b.at(A)), [A], filesOf(A), [["unlinkDir", B]]))
        .toEqual(expectedArrivals([A], filesOf(A)));
      expect(await inTree(b, "atoms/zz-a/item")).toBe(true);
    } finally {
      await b.close();
    }
  }, 60_000);

  it("removed and restored, its files reported as changes only: discovery is built again, the tree has it, it renders", async () => {
    const { b, deliver } = await project();
    try {
      await component(b, A);
      await b.step(() => b.remove(A), [["unlinkDir", A]]);
      expect(await inTree(b, "atoms/zz-a/item")).toBe(false);
      // chokidar reports the restored folder's files as changes (its watches of them outlived the folder), and
      // nothing else: no addDir, so no rescan either.
      const inA = (path: string): boolean => b.owns(path) && (b.rel(path) === A || b.rel(path).startsWith(`${A}/`));
      hooks.__testOnly_dropEvent = (event, path) => inA(path) && event !== "change";
      // Its template and data only: a change to a docs file sends tree-changed of its own.
      const back = ["item.hbs", "item.json"] as const;
      const restored = await b.step(async () => {
        for (const f of back) await save(b.at(`${A}/${f}`), FILES[f]);
        for (const f of back) deliver("change", b.at(`${A}/${f}`));
      });
      // The open page is told the tree changed (it refetches on it), and what it fetches has the component.
      expect(restored.messages).toContain(`{"type":"tree-changed"}`);
      expect(await inTree(b, "atoms/zz-a/item")).toBe(true);
      const page = await fetch(`${b.origin}/api/component/atoms/zz-a/item`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Item</p>");
    } finally {
      await b.close();
    }
  }, 60_000);

  it("moved in complete from outside the watched tree, with a folder in it: every folder and file handled once", async () => {
    const { b } = await project();
    try {
      await movedIn(b, "src/patterns/atoms/zz-m");
    } finally {
      await b.close();
    }
  }, 60_000);

  it("removed and made again at the same path: the folder and its files are handled again", async () => {
    const { b } = await project();
    try {
      await component(b, A);
      await b.step(() => b.remove(A), [["unlinkDir", A]]);
      expect(await inTree(b, "atoms/zz-a/item")).toBe(false);
      await component(b, A);
      expect(await inTree(b, "atoms/zz-a/item")).toBe(true);
    } finally {
      await b.close();
    }
  }, 60_000);
});

describe.runIf(rescanning)("a new folder's rescan cycle", () => {
  const D = "src/patterns/atoms/zz-late";
  const F = `${D}/item.hbs`;
  const ofD = (b: Bench, dir: string): boolean => b.owns(dir) && b.rel(dir) === D;
  const ofF = (b: Bench, path: string): boolean => b.owns(path) && b.rel(path) === F;
  const fileEvents = (events: string[][]): string[][] => events.filter(([, p]) => p === F);
  const shows = async (b: Bench, text: string): Promise<boolean> =>
    (await (await fetch(`${b.origin}/api/component/atoms/zz-late/item`)).text()).includes(text);
  const ended = (b: Bench, from: number) => (): boolean => cyclesEnded.slice(from).includes(b.at(D));

  it("adds a file it and chokidar both report once: chokidar's late add, after the file changed, is not a second add", async () => {
    const { b, deliver } = await project();
    try {
      // chokidar's own reports of the file are held back until its late add, delivered below: the scans report it first.
      let dropping = true;
      hooks.__testOnly_dropEvent = (event, path) => dropping && (event === "add" || event === "change") && ofF(b, path);
      let atGate = (): void => {};
      let gate: Promise<void> | null = null;
      let released = false;
      hooks.__testOnly_cycleTick = async (dir, watching) => {
        if (!ofD(b, dir)) return watching;
        if (gate) { atGate(); await gate; }
        return released && watching;
      };
      const endedFrom = cyclesEnded.length;
      const { events } = await b.step(async () => {
        const from = handled.length;
        await b.create(F, "<p class=\"late\">one</p>\n");
        await whenHandled(() => handled.slice(from).some(h => h.event === "add" && ofF(b, h.path)));
        const path = handled.slice(from).find(h => h.event === "add" && ofF(b, h.path))!.path;
        // The cycle held before its next scan: the file changes, and only then does chokidar's add for it come.
        let open = (): void => {};
        const parked = new Promise<void>(resolve => { atGate = resolve; });
        gate = new Promise<void>(resolve => { open = resolve; });
        await parked;
        await save(b.at(F), "<p class=\"late\">two</p>\n");
        dropping = false;
        deliver("add", path);
        released = true;
        gate = null;
        open();
        await until(ended(b, endedFrom), "the folder's rescan cycle ended");
      });
      expect(fileEvents(events)).toEqual([["add", F], ["change", F]]);
      expect(await shows(b, "two")).toBe(true);
    } finally {
      await b.close();
    }
  }, 60_000);

  it("sees a write between its last scan and the watches in its closing scan", async () => {
    const { b } = await project();
    try {
      // chokidar's reports of the file never arrive: only the cycle's scans can see it.
      hooks.__testOnly_dropEvent = (event, path) => (event === "add" || event === "change") && ofF(b, path);
      const added = (): boolean => handled.some(h => h.event === "add" && ofF(b, h.path));
      let wrote = false;
      hooks.__testOnly_cycleTick = async (dir, watching) => {
        if (!ofD(b, dir) || wrote) return watching;
        // The watches not shown until they are there and a scan has added the file; then the write, and they are.
        if (!watching || !added()) return false;
        await save(b.at(F), "<p class=\"late\">two</p>\n");
        wrote = true;
        return true;
      };
      const endedFrom = cyclesEnded.length;
      const { events } = await b.step(async () => {
        await b.create(F, "<p class=\"late\">one</p>\n");
        await until(ended(b, endedFrom), "the folder's rescan cycle ended");
      });
      expect(endedWhy.get(b.at(D))).toBe("watched");
      expect(fileEvents(events)).toEqual([["add", F], ["change", F]]);
      expect(await shows(b, "two")).toBe(true);
    } finally {
      await b.close();
    }
  }, 60_000);

  it("handles a file removed before the folder was watched as removed: its last scan finds it gone", async () => {
    const { b } = await project();
    try {
      // chokidar never reports the removal, as when it lands before the folder's watch: only the last scan can see it.
      hooks.__testOnly_dropEvent = (event, path) => event === "unlink" && ofF(b, path);
      const added = (): boolean => handled.some(h => h.event === "add" && ofF(b, h.path));
      let removed = false;
      let wasInTree = false;
      hooks.__testOnly_cycleTick = async (dir, watching) => {
        if (!ofD(b, dir) || removed) return watching;
        // Held open until the watches are there and a scan has added the file; then it is removed, and the
        // scan that follows is the last one.
        if (!watching || !added()) return false;
        wasInTree = await inTree(b, "atoms/zz-late/item");
        await rm(b.at(F));
        removed = true;
        return true;
      };
      const endedFrom = cyclesEnded.length;
      const { events } = await b.step(async () => {
        await b.create(F, "<p class=\"late\">one</p>\n");
        await until(ended(b, endedFrom), "the folder's rescan cycle ended");
      });
      expect(endedWhy.get(b.at(D))).toBe("watched");
      expect(fileEvents(events)).toEqual([["add", F], ["unlink", F]]);
      expect(wasInTree).toBe(true);
      expect(await inTree(b, "atoms/zz-late/item")).toBe(false);
    } finally {
      await b.close();
    }
  }, 60_000);

  it("hands what it reported to chokidar: a file chokidar never saw is reported removed after the cycle, once, also with its folder", async () => {
    const { b, forget } = await project();
    const G = `${D}/other.hbs`;
    const onlyOf = (events: string[][], rel: string) => events.filter(([, p]) => p === rel);
    try {
      const added = (rel: string): boolean => handled.some(h => h.event === "add" && b.owns(h.path) && b.rel(h.path) === rel);
      let forgot = false;
      hooks.__testOnly_cycleTick = async (dir, watching) => {
        if (!ofD(b, dir) || forgot) return watching;
        if (!watching || !added(F) || !added(G)) return false;
        // chokidar forgets both files, as when they land between its read of the new folder and its watch: it
        // would report nothing of them again. The scan that follows is the last.
        forget(b.at(F));
        forget(b.at(G));
        forgot = true;
        return true;
      };
      const endedFrom = cyclesEnded.length;
      await b.step(async () => {
        await b.create(F, "<p class=\"late\">one</p>\n");
        await b.create(G, "<p class=\"other\">one</p>\n");
        await until(ended(b, endedFrom), "the folder's rescan cycle ended");
      });
      expect(endedWhy.get(b.at(D))).toBe("watched");
      expect([await inTree(b, "atoms/zz-late/item"), await inTree(b, "atoms/zz-late/other")]).toEqual([true, true]);

      // One file removed, well after the cycle ended: reported once, and gone from the tree.
      const one = await b.step(() => b.remove(F));
      expect(onlyOf(one.events, F)).toEqual([["unlink", F]]);
      expect(await inTree(b, "atoms/zz-late/item")).toBe(false);

      // Then the whole folder: the other file reported removed once, and the folder's own unlinkDir. chokidar
      // sends the folder's unlinkDir first and the file's unlink from the file's own watch a little later (as for
      // any file it found itself), so the step waits for that unlink too.
      const all = await b.step(async () => {
        const from = handled.length;
        await b.remove(D);
        await whenHandled(() => handled.slice(from).some(h => h.event === "unlink" && b.owns(h.path) && b.rel(h.path) === G),
          () => `the unlink of ${G}; handled: ${JSON.stringify(b.handledSince(from))}`);
      });
      expect(onlyOf(all.events, G)).toEqual([["unlink", G]]);
      expect(onlyOf(all.events, D)).toEqual([["unlinkDir", D]]);
      expect(await inTree(b, "atoms/zz-late/other")).toBe(false);
      // And nothing of either arrives later.
      const later = await b.step(async () => {});
      expect([...onlyOf(later.events, F), ...onlyOf(later.events, G), ...onlyOf(later.events, D)]).toEqual([]);
    } finally {
      await b.close();
    }
  }, 60_000);

  it("lets chokidar's add after it ended through lastHandled: skipped when the file is as handled, handled when not", async () => {
    const { b, deliver } = await project();
    try {
      // chokidar's own reports of the file, once `dropping`; the late add the test delivers goes through.
      let dropping = false;
      let delivering = false;
      hooks.__testOnly_dropEvent = (event, path) => dropping && !delivering && (event === "add" || event === "change") && ofF(b, path);
      const late = (path: string): void => { delivering = true; try { deliver("add", path); } finally { delivering = false; } };
      const from = handled.length;
      await arrive(b, () => b.create(F, "<p class=\"late\">one</p>\n"), [D], [F], [], [D]);
      const path = handled.slice(from).find(h => (h.event === "add" || h.event === "change") && ofF(b, h.path))!.path;
      // After the cycle, the file as last handled: the late add is skipped.
      expect(await b.step(async () => { late(path); }, [])).toEqual({ messages: [], events: [] });
      // After the cycle, the file changed and chokidar's change for it missed: the late add is handled, as an
      // add, and what renders is what the file holds. Only the event's name differs from a change.
      dropping = true;
      const changed = await b.step(async () => {
        await save(b.at(F), "<p class=\"late\">two</p>\n");
        late(path);
      });
      expect(fileEvents(changed.events)).toEqual([["add", F]]);
      expect(await shows(b, "two")).toBe(true);
    } finally {
      await b.close();
    }
  }, 60_000);

  it("counts a folder in it queued before it started as reported, however slow its first scan", async () => {
    const { b } = await project();
    const BTN = "src/patterns/atoms/btn/btn.hbs";
    const M = "src/patterns/atoms/zz-q";
    const SUB = `${M}/sub`;
    let release = (): void => {};
    try {
      // The button's change is held, so the queue backs up behind it: the new folder's addDir and its inner
      // folder's both wait there, the inner one queued after it, before the new folder's cycle starts.
      let holding = false;
      hooks.__testOnly_holdHandler = (event, path) => {
        if (holding || event !== "change" || !b.owns(path) || b.rel(path) !== BTN) return undefined;
        holding = true;
        return new Promise<void>(resolve => { release = resolve; });
      };
      let subReported = false;
      hooks.__testOnly_dropEvent = (event, path) => {
        if (event === "addDir" && b.owns(path) && b.rel(path) === SUB) subReported = true;
        return false;
      };
      // The new folder's first scan is slow: it waits until the inner folder's addDir has been handled, so
      // that addDir is no longer waiting when the scan finds the folder, and only the cycle's record of it
      // keeps the scan from reporting it again.
      const subHandled = (): boolean => handled.some(h => h.event === "addDir" && b.owns(h.path) && b.rel(h.path) === SUB);
      let first = true;
      hooks.__testOnly_cycleTick = async (dir, watching) => {
        if (!first || !b.owns(dir) || b.rel(dir) !== M) return watching;
        first = false;
        await until(subHandled, "the inner folder's addDir handled");
        return watching;
      };
      const outside = join(tmp, `outside-${n++}`, "zz-q");
      await save(join(outside, "item.hbs"), FILES["item.hbs"]);
      await save(join(outside, "sub", "sub-item.hbs"), "<p class=\"sub\">sub</p>\n");
      const endedFrom = cyclesEnded.length;
      const { events } = await b.step(async () => {
        await save(b.at(BTN), `<button class="btn">Two</button>\n`);
        await until(() => holding, "the button's change held");
        await rename(outside, b.at(M));
        await until(() => subReported, "chokidar's addDir of the inner folder");
        release();
        await until(() => [M, SUB].every(d => cyclesEnded.slice(endedFrom).includes(b.at(d))), "both rescan cycles ended");
      });
      expect(events.filter(([e]) => e === "addDir")).toEqual([["addDir", M], ["addDir", SUB]]);
    } finally {
      release();
      await b.close();
    }
  }, 60_000);

  it("still not watched after NEW_FOLDER_CAP_MS, ends and says so once; what it found is handled", async () => {
    const warn = vi.spyOn(console, "warn");
    const { b } = await project();
    try {
      hooks.__testOnly_cycleTick = (dir, watching) => (ofD(b, dir) ? false : watching);
      const endedFrom = cyclesEnded.length;
      const { events } = await b.step(async () => {
        await b.create(F, "<p class=\"late\">one</p>\n");
        await until(ended(b, endedFrom), "the folder's rescan cycle ended");
      });
      expect(endedWhy.get(b.at(D))).toBe("cap");
      expect(fileEvents(events)).toEqual([["add", F]]);
      expect(warn.mock.calls.map(c => c.join(" ")).filter(m => m.includes("still not watched"))).toHaveLength(1);
      expect(await shows(b, "one")).toBe(true);
    } finally {
      warn.mockRestore();
      await b.close();
    }
  }, 60_000);
});

describe.runIf(rescanning)("with chokidar's _closers not readable", () => {
  it("still sees a file renamed into a new folder, and says once that new-folder detection is degraded", async () => {
    hooks.__testOnly_hideChokidarWatches = true;
    const warn = vi.spyOn(console, "warn");
    const { b } = await project();
    try {
      for (const name of ["zz-a", "zz-b"]) {
        const file = `src/patterns/atoms/${name}/${name}.hbs`;
        const { events, messages } = await b.step(() => b.create(file, `<p>${name}</p>\n`),
          [["addDir", dirname(file)], ["add", file]]);
        expect(events).toEqual([["addDir", dirname(file)], ["add", file]]);
        expect(messages).toContain(`{"type":"tree-changed"}`);
      }
      expect(warn.mock.calls.map(c => c.join(" ")).filter(m => m.includes(DEGRADED))).toHaveLength(1);
    } finally {
      warn.mockRestore();
      await b.close();
    }
  }, 60_000);

  it("moved in complete, with a folder in it: every folder and file handled once, through every scan of the fallback", async () => {
    hooks.__testOnly_hideChokidarWatches = true;
    const { b } = await project();
    try {
      await movedIn(b, "src/patterns/atoms/zz-m");
    } finally {
      await b.close();
    }
  }, 60_000);

  it("with _closers readable, says nothing of it", async () => {
    const warn = vi.spyOn(console, "warn");
    const { b } = await project();
    try {
      await b.step(() => b.create("src/patterns/atoms/zz-c/zz-c.hbs", "<p>c</p>\n"));
      expect(warn.mock.calls.map(c => c.join(" ")).filter(m => m.includes(DEGRADED) || m.includes("still not watched"))).toEqual([]);
    } finally {
      warn.mockRestore();
      await b.close();
    }
  }, 60_000);
});
