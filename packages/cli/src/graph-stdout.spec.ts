// pd graph, pd describe and pd affected print the same answers the in-process functions give (the ones the MCP tools
// will give), whole, through a shell pipe as CI reads them, and an unknown id fails with the nearest ids. Runs the
// built binary: how the process prints and exits is part of what is checked.

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { affectedOf, describeOf, graphJson, readProjectGraph } from "@pattern-dump/dev-server";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";

const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const testBench = fileURLToPath(new URL("../../../test-bench/", import.meta.url));

/** Through a real shell pipe (`| cat`), from `cwd`, as audit-stdout.spec.ts runs pd audit. */
function runPiped(args: string[], cwd = testBench): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const quote = (a: string) => `'${a.replaceAll("'", "'\\''")}'`;
  const pipeline = `set -o pipefail; ${[process.execPath, bin, ...args].map(quote).join(" ")} | cat`;
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", pipeline], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}

const read = () => readProjectGraph(validateConfig(testBenchConfig, "test-bench"), testBench.replace(/\/$/, ""));

describe.skipIf(process.platform === "win32")("pd graph, pd describe and pd affected", () => {
  it("pd graph --json prints the project graph whole", async () => {
    const { code, stdout } = await runPiped(["graph", "--json"]);
    expect(code).toBe(0);
    // More than a pipe's first write (512 bytes was where pd audit once stopped), and equal to the graph below: whole.
    expect(stdout.length).toBeGreaterThan(8_192);
    expect(JSON.parse(stdout)).toEqual(graphJson((await read()).graph));
  }, 120_000);

  it("pd describe <id> --json prints the four answers", async () => {
    const { code, stdout } = await runPiped(["describe", "atoms/button", "--json"]);
    expect(code).toBe(0);
    const { graph, discoveryMap } = await read();
    expect(JSON.parse(stdout)).toEqual(await describeOf(graph, "atoms/button", discoveryMap));
  }, 120_000);

  it("pd describe of an unknown id fails with the nearest id", async () => {
    const { code, stdout, stderr } = await runPiped(["describe", "atoms/buton"]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(`there is no component "atoms/buton" in this project: did you mean "atoms/button"`);
  }, 120_000);

  it("pd affected takes files from the current folder and ids, and prints what they reach", async () => {
    const { code, stdout } = await runPiped(["affected", "src/styles/00-base/_tokens.scss", "molecules/field", "--json"]);
    expect(code).toBe(0);
    const { graph, pagesPrefix } = await read();
    expect(JSON.parse(stdout)).toEqual(affectedOf(graph, { ids: ["molecules/field"], files: ["src/styles/00-base/_tokens.scss"] }, pagesPrefix));
  }, 120_000);

  it("without --json, a summary", async () => {
    expect((await runPiped(["graph"])).stdout).toMatch(/^Project graph \(version 1\)\n {2}\d+ nodes: /);
    expect((await runPiped(["describe", "atoms/button"])).stdout).toContain("atoms/button (component)");
    expect((await runPiped(["affected", "molecules/field"])).stdout).toMatch(/^Changed: molecules\/field\n/);
  }, 120_000);
});
