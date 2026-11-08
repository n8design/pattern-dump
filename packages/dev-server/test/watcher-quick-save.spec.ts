// A second save of a file, made right after the first was handled, is handled too. chokidar drops a change
// to the same path within 50 ms of the previous one (test/watcher-chokidar.spec.ts), which on Linux a quick
// second save (a format-on-save, a tool writing twice) does: the page kept the first save. watch.ts looks
// at a changed file again after CHANGE_RECHECK_MS and handles what it finds changed.
//
// Deterministic on Linux, where the second save always lands in chokidar's window; on macOS it is
// reported by chokidar itself, and the spec checks that nothing is handled twice.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";
import { CHANGE_RECHECK_MS } from "../src/watch.js";
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
  it("is handled, once, with its own reload", async () => {
    await b.reopen();
    await b.barrier();
    const from = handled.length;
    const msgFrom = b.messages.length;
    const changes = () => b.handledSince(from).filter(([e, rel]) => e === "change" && rel === TEMPLATE).length;
    const swaps = () => b.messages.slice(msgFrom).filter(m => m === `{"type":"content-swap","componentId":"atoms/quick"}`).length;

    await saveInTwoSteps(b.at(TEMPLATE), "<p>second</p>\n");
    await whenHandled(() => changes() === 1, () => `the first save handled; handled: ${JSON.stringify(b.handledSince(from))}`);
    // At once, as an editor's format-on-save writes again.
    await saveInTwoSteps(b.at(TEMPLATE), "<p>third</p>\n");
    await whenHandled(() => changes() === 2, () => `the second save handled; handled: ${JSON.stringify(b.handledSince(from))}`);

    // Settled: past one more recheck, the file unchanged, nothing more handled.
    await new Promise(resolve => setTimeout(resolve, CHANGE_RECHECK_MS * 3));
    await b.barrier();
    expect(changes()).toBe(2);
    expect(swaps()).toBe(2);
    expect(await (await fetch(`${b.origin}/preview/atoms/quick`)).text()).toContain("<p>third</p>");
  }, 30_000);
});
