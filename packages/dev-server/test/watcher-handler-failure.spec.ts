// A watcher handler that fails (rejects, or throws before it returns) is reported like any other server
// problem, in the terminal and on the open pages, and pd dev keeps running: the next change is handled as
// usual. The failure is forced with the test-only hook `__testOnly_failHandler`, so it does not depend on
// the file system refusing a read (as root, a chmod 000 file is still readable).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

type Fail = (event: string, path: string) => "reject" | "throw" | undefined;
const hooks = globalThis as { __testOnly_failHandler?: Fail };

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});
const FILE = "src/patterns/atoms/btn/btn.hbs";

let tmp = "";
let n = 0;
async function project(): Promise<Bench> {
  const root = join(tmp, `site-${n++}`);
  await mkdir(dirname(join(root, FILE)), { recursive: true });
  await save(join(root, FILE), `<button class="btn">One</button>\n`);
  await mkdir(join(root, "src/styles"), { recursive: true });
  const b = new Bench(root, "atoms/btn");
  await b.start(config);
  return b;
}

// Anything the process would otherwise lose: a rejection nobody handles, an exception nobody catches.
const lost: string[] = [];
const onRejection = (e: unknown) => { lost.push(`unhandledRejection: ${String(e)}`); };
const onException = (e: unknown) => { lost.push(`uncaughtException: ${String(e)}`); };

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-handler-failure-"));
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);
});
afterEach(() => { delete hooks.__testOnly_failHandler; });
afterAll(async () => {
  process.off("unhandledRejection", onRejection);
  process.off("uncaughtException", onException);
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a watcher handler that fails", () => {
  for (const how of ["reject", "throw"] as const) {
    it(`by ${how === "reject" ? "rejecting" : "throwing"}: is reported, and pd dev handles the next change`, async () => {
      const b = await project();
      lost.length = 0;
      const forced: string[] = [];
      hooks.__testOnly_failHandler = (event, path) => {
        if (event !== "change" || !path.endsWith(FILE)) return undefined;
        forced.push(path);
        return how;
      };
      const errors: string[] = [];
      const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(" ")); });
      let failed;
      try {
        failed = await b.step(() => save(b.at(FILE), `<button class="btn">Two</button>\n`), [["change", FILE]]);
      } finally {
        spy.mockRestore();
      }
      // The failure really happened: the hook was asked for this change and made it fail.
      expect(forced).toHaveLength(1);
      const message = `${FILE} (change) was not handled: failed for a test`;
      expect(failed.messages).toEqual([JSON.stringify({ type: "error", scope: "build", message })]);
      expect(errors).toContain(`[dev-server] ${message}`);
      // Wait a turn so a rejection nobody handled would have been reported, then: none.
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(lost).toEqual([]);

      delete hooks.__testOnly_failHandler;
      const next = await b.step(() => save(b.at(FILE), `<button class="btn">Three</button>\n`), [["change", FILE]]);
      expect(next.messages).toEqual([`{"type":"content-swap","componentId":"atoms/btn"}`]);
    }, 60_000);
  }
});
