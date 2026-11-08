// chokidar can report one write twice (on macOS under load, one writeFile as two events about 100 ms
// apart, past its own 50 ms window), and the second is not handled again: a change to a file that is as
// its last handling saw it, by stamp and by content, is skipped. The same stamp with other content is a
// real edit (on a file system with coarse timestamps, a same-size edit in the same second keeps its stamp)
// and is handled. The duplicate is delivered with the test-only hook `__testOnly_onWatchStarted`, and the
// same stamp is forced with `__testOnly_watchStamp`, so neither depends on timing.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { Bench, closeAll, handled } from "./watch-harness.js";

type Deliver = (event: "change", path: string) => void;
const hooks = globalThis as {
  __testOnly_onWatchStarted?: (deliver: Deliver) => void;
  __testOnly_watchStamp?: (path: string, stamp: string) => string;
};

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});
const FILE = "src/patterns/atoms/btn/btn.hbs";
const RELOAD = [`{"type":"content-swap","componentId":"atoms/btn"}`];

let tmp = "";
let n = 0;
/** A fresh project with one component, open in the workbench; and its watcher's deliver function. */
async function project(): Promise<{ b: Bench; deliver: Deliver }> {
  const root = join(tmp, `site-${n++}`);
  await mkdir(dirname(join(root, FILE)), { recursive: true });
  await writeFile(join(root, FILE), `<button class="btn">One</button>\n`);
  await mkdir(join(root, "src/styles"), { recursive: true });
  let deliver: Deliver | undefined;
  hooks.__testOnly_onWatchStarted = d => { deliver = d; };
  const b = new Bench(root, "atoms/btn", join(tmp, "staging"));
  await b.start(config);
  delete hooks.__testOnly_onWatchStarted;
  if (!deliver) throw new Error("the watcher did not hand over its deliver function");
  return { b, deliver };
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-duplicate-change-")); });
afterEach(() => { delete hooks.__testOnly_watchStamp; });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a change reported twice", () => {
  it("is handled once: the second report, of a file as the first left it, is skipped", async () => {
    const { b, deliver } = await project();
    const from = handled.length;
    const first = await b.step(() => writeFile(b.at(FILE), `<button class="btn">Two</button>\n`), [["change", FILE]]);
    expect(first.events).toEqual([["change", FILE]]);
    expect(first.messages).toEqual(RELOAD);

    // chokidar's second report of that write: the path as it reported the first.
    const path = handled.slice(from).find(h => b.owns(h.path) && b.rel(h.path) === FILE)!.path;
    const again = await b.step(async () => { deliver("change", path); }, []);
    expect(again).toEqual({ messages: [], events: [] });

    // A later edit is still handled.
    const next = await b.step(() => writeFile(b.at(FILE), `<button class="btn">Three</button>\n`), [["change", FILE]]);
    expect(next.events).toEqual([["change", FILE]]);
    expect(next.messages).toEqual(RELOAD);
  }, 60_000);

  it("with the same stamp and other content is a real edit, and is handled", async () => {
    const { b } = await project();
    // Every write to the file gets the same stamp, as with timestamps too coarse to tell two saves apart.
    hooks.__testOnly_watchStamp = (path, stamp) => (path.endsWith(FILE) ? "same-stamp" : stamp);
    const first = await b.step(() => writeFile(b.at(FILE), `<button class="btn">Aaa</button>\n`), [["change", FILE]]);
    expect(first.events).toEqual([["change", FILE]]);

    // Same size, same stamp, other content.
    const second = await b.step(() => writeFile(b.at(FILE), `<button class="btn">Bbb</button>\n`), [["change", FILE]]);
    expect(second.events).toEqual([["change", FILE]]);
    expect(second.messages).toEqual(RELOAD);
    expect(await (await fetch(`${b.origin}/api/component/atoms/btn`)).text()).toContain("Bbb");
  }, 60_000);

  it("after an add, a change reporting the same content is not a second change", async () => {
    const { b, deliver } = await project();
    const NEW = "src/patterns/atoms/fresh/fresh.hbs";
    const from = handled.length;
    // Moved into place in one step (as the harness creates every new file), and handled as an add.
    const added = await b.step(() => b.create(NEW, `<p class="fresh">One</p>\n`), [["add", NEW]]);
    expect(added.events.filter(([e]) => e !== "addDir")).toEqual([["add", NEW]]);

    // The change fsevents can report after it, for the same content: skipped.
    const path = handled.slice(from).find(h => b.owns(h.path) && b.rel(h.path) === NEW)!.path;
    const again = await b.step(async () => { deliver("change", path); }, []);
    expect(again).toEqual({ messages: [], events: [] });

    // A real edit is still handled.
    const edited = await b.step(() => writeFile(b.at(NEW), `<p class="fresh">Two</p>\n`), [["change", NEW]]);
    expect(edited.events).toEqual([["change", NEW]]);
  }, 60_000);
});
