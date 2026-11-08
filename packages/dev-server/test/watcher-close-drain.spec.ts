// Closing pd dev lets the watcher's handler that is running (and the events already waiting) finish before
// the socket and the HTTP server close, so no handler writes its scratch files after close has resolved.
// The wait is bounded: a handler that never settles is named in the terminal and pd dev closes anyway.
// A handler is held with the test-only hook `__testOnly_holdHandler`.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { pdScratchDir } from "../src/scratch.js";
import { CLOSE_DRAIN_MS } from "../src/watch.js";
import { startOnFreeWsPort } from "./free-ports.js";

const hooks = globalThis as {
  __testOnly_holdHandler?: (event: string, path: string) => Promise<void> | undefined;
  __testOnly_onEventHandled?: (event: string, path: string, waiting: number) => void;
};
const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
}), "site");

let tmp = "";
let n = 0;
const roots: string[] = [];
async function site(): Promise<string> {
  const root = join(tmp, `site-${n++}`);
  roots.push(root);
  await mkdir(join(root, "src/patterns/atoms/btn"), { recursive: true });
  await writeFile(join(root, "src/patterns/atoms/btn/btn.hbs"), `<button>Hi</button>\n`);
  await mkdir(join(root, "src/styles"), { recursive: true });
  return root;
}
/** A new template, written beside the project and moved in, so it arrives as one add. */
async function addTemplate(root: string): Promise<string> {
  const file = join(root, "src/patterns/atoms/zz/zz.hbs");
  const staged = join(tmp, `staged-${n++}`);
  await writeFile(staged, "<p>zz</p>\n");
  await mkdir(dirname(file), { recursive: true });
  await rename(staged, file);
  return file;
}
/** Hold the handler of the add of `file`: resolves once it is held, with its release. */
function holdAdd(file: string, forever = false): Promise<() => void> {
  return new Promise(engaged => {
    hooks.__testOnly_holdHandler = (event, path) => {
      if (event !== "add" || !path.endsWith("atoms/zz/zz.hbs")) return undefined;
      return new Promise<void>(release => { engaged(forever ? () => {} : release); });
    };
    void file;
  });
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-close-drain-")); });
afterEach(() => { delete hooks.__testOnly_holdHandler; delete hooks.__testOnly_onEventHandled; });
afterAll(async () => {
  for (const root of roots) await rm(pdScratchDir(root), { recursive: true, force: true });
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("closing pd dev while a watcher handler runs", () => {
  it("waits for it: the handler finishes, and writes its scratch files, before close resolves", async () => {
    const root = await site();
    const { server } = await startOnFreeWsPort(config, root);
    const order: string[] = [];
    hooks.__testOnly_onEventHandled = (event, path) => { if (path.endsWith("atoms/zz/zz.hbs")) order.push(`handled ${event}`); };
    const file = join(root, "src/patterns/atoms/zz/zz.hbs");
    const held = holdAdd(file);
    await addTemplate(root);
    const release = await held;

    const closing = server.close().then(() => { order.push("closed"); });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(order).toEqual([]);
    release();
    await closing;
    expect(order).toEqual(["handled add", "closed"]);

    // The scratch report the handler writes is there, and nothing writes it after close.
    const report = join(pdScratchDir(root), "FLATTENED.generated.md");
    const atClose = (await stat(report)).mtimeMs;
    await new Promise(resolve => setTimeout(resolve, 500));
    expect((await stat(report)).mtimeMs).toBe(atClose);
  }, 30_000);

  it("closes anyway after a bounded wait, naming a handler that never settles", async () => {
    const root = await site();
    const { server } = await startOnFreeWsPort(config, root);
    const held = holdAdd(join(root, "src/patterns/atoms/zz/zz.hbs"), true);
    await addTemplate(root);
    await held;

    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(" ")); });
    try {
      const started = Date.now();
      await server.close();
      const took = Date.now() - started;
      expect(took).toBeGreaterThanOrEqual(CLOSE_DRAIN_MS - 50);
      expect(took).toBeLessThan(CLOSE_DRAIN_MS + 5_000);
    } finally {
      spy.mockRestore();
    }
    expect(errors).toContain(`[dev-server] Closing with a handler still running after ${CLOSE_DRAIN_MS / 1000} s: src/patterns/atoms/zz/zz.hbs (add); closing anyway.`);
  }, 30_000);
});
