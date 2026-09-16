// `pd dev` while another one still holds its ports — the everyday case that used to end in a raw
// `node:events … Unhandled 'error' event … EADDRINUSE` stack. Runs the built binary, since the
// defect was in how the process died, not in anything a unit could return.

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const testBench = fileURLToPath(new URL("../../../test-bench/", import.meta.url));

function runPd(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", c => { stderr += c; });
    child.on("error", reject);
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on("close", code => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}

describe("pd dev on a taken live-reload port", () => {
  it("exits 1 with one readable message and no stack trace", async () => {
    const blocker = createServer();
    await new Promise<void>(r => blocker.listen(0, r));
    const port = (blocker.address() as { port: number }).port;
    try {
      // --port P makes live reload P + 1; take exactly that port, as a running `pd dev` would.
      const { code, stderr } = await runPd(["dev", "--root", testBench, "--port", String(port - 1)]);
      expect(code).toBe(1);
      expect(stderr).toContain(`[pd] Port ${port} is already in use, so live reload cannot start.`);
      expect(stderr).toContain(`pd dev --port ${port - 1 + 100}`);
      expect(stderr).not.toContain("node:events");
      expect(stderr).not.toMatch(/\n\s+at /); // no stack frames
    } finally {
      await new Promise<void>(r => blocker.close(() => r()));
    }
  }, 90_000);
});
