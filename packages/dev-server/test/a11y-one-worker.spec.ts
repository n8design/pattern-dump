// One worker for the page check (--check-workers 1, and the default on a machine with two cores or little memory) is a
// pool of one, replaced every PAGES_PER_WORKER pages like the others: it used to check every page in the build's own
// thread, whose heap kept the windows of the pages checked until it ran out (2,000 pages: an 8.4 GB heap, the build
// stopped). Run in a child process with a small heap, over more pages than that heap holds checked in one thread.
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { save } from "../../../test-support/save.js";

/** Checks `pages` pages with one worker; prints how many came back. */
const SCRIPT = `
const { runPagesA11y } = await import(process.argv[2]);
const body = Array.from({ length: 60 }, (_, i) => \`<section><h2>Part \${i}</h2><p>Text <a href="/x/\${i}/">link \${i}</a></p><ul><li>a</li><li>b</li></ul></section>\`).join("");
const page = i => \`<!doctype html><html lang="en"><head><title>Page \${i}</title></head><body><header><p>Site</p></header><main><h1>Page \${i}</h1>\${body}</main><footer><p>F</p></footer></body></html>\`;
const results = await runPagesA11y(Array.from({ length: Number(process.argv[3]) }, (_, i) => page(i)), { workers: 1 });
console.log("checked " + results.length);
`;

describe("the page check with one worker", () => {
  it("checks more pages than the build's heap could hold checked in one thread", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pd-one-worker-"));
    try {
      const script = join(dir, "check.mjs");
      await save(script, SCRIPT);
      // 50 such pages checked in one thread peaked at 684 MB; the build's own heap here is 256 MB.
      const out = await new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
        execFile(process.execPath, ["--max-old-space-size=256", script, new URL("../../a11y/dist/index.js", import.meta.url).href, "50"],
          { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
          (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }));
      });
      expect(out.stderr).not.toContain("heap out of memory");
      expect(out.stdout.trim()).toBe("checked 50");
      expect(out.code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 150_000);
});
