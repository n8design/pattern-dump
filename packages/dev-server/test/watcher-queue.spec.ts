// Watcher events are handled one at a time, in the order they arrived: an event waits until the handler
// ahead of it has finished, so messages go out in the order the files changed. An event identical to one
// still waiting (same event, same file) is not queued again. A handler is held with the test-only hook
// `__testOnly_holdHandler`; events are delivered as chokidar would with `__testOnly_onWatchStarted`, so
// what is waiting is known without timing.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

type Deliver = (event: "change", path: string) => void;
const hooks = globalThis as {
  __testOnly_onWatchStarted?: (deliver: Deliver) => void;
  __testOnly_holdHandler?: (event: string, path: string) => Promise<void> | undefined;
};

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});
const A = "src/patterns/atoms/a/a.hbs";
const B = "src/patterns/atoms/b/b.hbs";

let tmp = "";
let n = 0;
async function project(): Promise<{ b: Bench; deliver: Deliver }> {
  const root = join(tmp, `site-${n++}`);
  for (const [rel, text] of [[A, "<p>a</p>\n"], [B, "<p>b</p>\n"]]) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  await mkdir(join(root, "src/styles"), { recursive: true });
  let deliver: Deliver | undefined;
  hooks.__testOnly_onWatchStarted = d => { deliver = d; };
  const b = new Bench(root, null);
  await b.start(config);
  delete hooks.__testOnly_onWatchStarted;
  if (!deliver) throw new Error("the watcher did not hand over its deliver function");
  return { b, deliver };
}

/** Hold the handler for `rel` until released; record the order handlers start in. */
function holdOne(b: Bench, rel: string) {
  const starts: string[] = [];
  let release = (): void => {};
  let holding = (): void => {};
  const held = new Promise<void>(resolve => { holding = resolve; });
  hooks.__testOnly_holdHandler = (event, path) => {
    if (!b.owns(path) || path.includes(".__testOnly_barrier")) return undefined;
    starts.push(`${event} ${b.rel(path)}`);
    if (b.rel(path) !== rel || starts.length > 1) return undefined;
    holding();
    return new Promise<void>(resolve => { release = resolve; });
  };
  return { starts, held, release: () => release() };
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-watcher-queue-")); });
afterEach(() => { delete hooks.__testOnly_holdHandler; });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("watcher events", () => {
  it("are handled one at a time, in the order they arrived, and their messages go out in that order", async () => {
    const { b, deliver } = await project();
    const hold = holdOne(b, A);
    const fromMsg = b.messages.length;
    const from = handled.length;
    await save(b.at(A), "<p>a, saved</p>\n");
    await hold.held;
    // While A's handler is held, B's change arrives. Delivery queues it at once, so had it not waited, its
    // handler would have started inside deliver().
    await save(b.at(B), "<p>b, saved</p>\n");
    deliver("change", b.at(B));
    expect(hold.starts).toEqual([`change ${A}`]);

    hold.release();
    await whenHandled(() => [A, B].every(rel => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === rel)));
    await b.barrier();
    expect(hold.starts.slice(0, 2)).toEqual([`change ${A}`, `change ${B}`]);
    const swaps = b.messages.slice(fromMsg).filter(m => m.includes(`"content-swap"`));
    expect(swaps).toEqual([`{"type":"content-swap","componentId":"atoms/a"}`, `{"type":"content-swap","componentId":"atoms/b"}`]);
  }, 60_000);

  it("are queued once when the same change of one file arrives again while it waits", async () => {
    const { b, deliver } = await project();
    const hold = holdOne(b, A);
    const from = handled.length;
    await save(b.at(A), "<p>a, saved</p>\n");
    await hold.held;
    // Three reports of B's change while A's handler is held: one waits.
    await save(b.at(B), "<p>b, saved</p>\n");
    for (let i = 0; i < 3; i++) deliver("change", b.at(B));
    hold.release();
    // When A's handler finishes, the hook reports what is still waiting: B's change, once. (The skip for
    // an unchanged file would hide extra copies from the handler count, so the queue is what is checked.)
    await whenHandled(() => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === A));
    const atA = handled.slice(from).find(h => b.owns(h.path) && b.rel(h.path) === A)!;
    expect(atA.stillRunning).toBe(1);
    await b.barrier();
    expect(handled.slice(from).filter(h => b.owns(h.path) && b.rel(h.path) === B && h.event === "change")).toHaveLength(1);
  }, 60_000);
});
