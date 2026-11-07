// chokidar's own behaviour that watch.ts works around, pinned so an upgrade that changes it turns red.
// chokidar drops a `change` to a path within 50 ms of the previous one and never reports it later
// (`_throttle(EV_CHANGE, path, 50)` in its `_emit`). watch.ts looks at a changed file again after
// CHANGE_RECHECK_MS, which must stay outside that window.
//
// Linux only: there events arrive within milliseconds, so a second save can land in the window. With
// macOS's fsevents they arrive about 100 ms after the write, outside it, and the drop cannot be produced
// through the file system.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { CHANGE_RECHECK_MS } from "../src/watch.js";

let tmp = "";
let file = "";
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
  await writeFile(file, "");
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
    await appendFile(file, "1");
    expect(await first).toBe(true);
    // At once, inside the window.
    const second = reported(500);
    await appendFile(file, "2");
    expect(await second).toBe(false);
  });

  it("reports a change made once CHANGE_RECHECK_MS has passed since the previous one", async () => {
    const first = reported(1_000);
    await appendFile(file, "3");
    expect(await first).toBe(true);
    await new Promise(resolve => setTimeout(resolve, CHANGE_RECHECK_MS));
    const next = reported(1_000);
    await appendFile(file, "4");
    expect(await next).toBe(true);
  });
});
