// A second save of a file, made right after the first was handled, is handled too. chokidar drops a change
// to the same path within 50 ms of the previous one (test/watcher-chokidar.spec.ts), which on Linux a quick
// second save (a format-on-save, a tool writing twice) does: the page kept the first save. watch.ts looks
// at a changed file again after CHANGE_RECHECK_MS and handles what it finds changed.
//
// Deterministic on Linux, where the second save always lands in chokidar's window; on macOS it is
// reported by chokidar itself. Both saves are written in place (saveInTwoSteps), as an editor saves and as
// chokidar's drop needs: the OS may report each as one change or two, and the watcher can handle the file
// between the truncate and the write (a swap of its own). So the spec asserts what the page ends with, the
// last save in the preview, and a bound on the swaps: at least one per save, at most two per in-place save
// (2 to 4), never an exact count of what was handled. FINDINGS-fix-watcher-linux.md has the hold that would
// make it exactly 2.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";
import { save, saveInTwoSteps } from "../../../test-support/save.js";

let tmp = "";
let b: Bench;
const TEMPLATE = "src/patterns/atoms/quick/quick.hbs";

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await save(path, text);
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-quick-save-"));
  const root = join(tmp, "site");
  await write(join(root, TEMPLATE), "<p>first</p>\n");
  await mkdir(join(root, "src/styles"), { recursive: true });
  b = new Bench(root, "atoms/quick");
  await b.start(validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
  }), "site"));
}, 60_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a quick second save", () => {
  it("is handled, with its own reload", async () => {
    // One step, two saves: the second right after the first is handled, as an editor's format-on-save
    // writes again. The step returns once the watcher has handled the file as it is on disk now.
    const r = await b.step(async () => {
      const from = handled.length;
      await saveInTwoSteps(b.at(TEMPLATE), "<p>second</p>\n");
      await whenHandled(() => b.handledSince(from).some(([e, rel]) => e === "change" && rel === TEMPLATE),
        () => `the first save handled; handled: ${JSON.stringify(b.handledSince(from))}`);
      await saveInTwoSteps(b.at(TEMPLATE), "<p>third</p>\n");
    });
    const swaps = r.messages.filter(m => m === `{"type":"content-swap","componentId":"atoms/quick"}`).length;
    expect(swaps, "at least one content swap per save").toBeGreaterThanOrEqual(2);
    expect(swaps, "at most two per in-place save (truncate, then write)").toBeLessThanOrEqual(4);
    expect(await (await fetch(`${b.origin}/preview/atoms/quick`)).text()).toContain("<p>third</p>");
  }, 30_000);
});

