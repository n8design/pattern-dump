// `pd audit --format json` is the CI-consumable report, so it must survive a PIPE. It used to end in
// process.exit(0) straight after writing, which drops whatever stdout has not flushed yet: piped
// through anything, the JSON stopped at 512 bytes and did not parse. Runs the built binary, since
// the defect is in how the process exits, not in what it computes.

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const testBench = fileURLToPath(new URL("../../../test-bench/", import.meta.url));

/** Through a real shell pipe (`| cat`). A Node parent reading the pipe directly drains it fast
 *  enough to hide the truncation; a shell pipeline — how CI actually consumes the report — does not. */
function runPiped(args: string[]): Promise<{ code: number | null; stdout: string }> {
  const quote = (a: string) => `'${a.replaceAll("'", "'\\''")}'`;
  const pipeline = `set -o pipefail; ${[process.execPath, bin, ...args].map(quote).join(" ")} 2>/dev/null | cat`;
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", pipeline], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout }));
  });
}

describe.skipIf(process.platform === "win32")("pd audit --format json over a pipe", () => {
  it("writes the complete report, which parses", async () => {
    const { code, stdout } = await runPiped(["audit", "--root", testBench, "--format", "json"]);
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(512);
    const report = JSON.parse(stdout) as { headline: string; totals: { components: number } };
    expect(report.totals.components).toBeGreaterThan(0);
  }, 120_000);
});
