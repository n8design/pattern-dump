// pd mcp's stdout is the protocol channel: every line on it is a JSON-RPC message, and everything else pd dev prints
// (its start, a save's reload lines, a warning, an error) goes to stderr, where a client shows or drops it. A stray line
// on stdout breaks a client that reads it. Runs the built CLI on a copy of test-bench and reads its raw stdout, while
// saves and a warning make pd dev print.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cli = join(repo, "packages/cli/dist/index.js");
let tmp = "";
let root = "";
let child: ChildProcessWithoutNullStreams;
let stdout = "";
let stderr = "";

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-mcp-stdout-"));
  root = join(tmp, "test-bench");
  for (const file of execFileSync("git", ["ls-files", "test-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("test-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  // The pattern package test-bench uses, where the copy can find it.
  await mkdir(join(root, "node_modules"), { recursive: true });
  await cp(join(repo, "test-bench/packages/pd-fixture-ui"), join(root, "node_modules/pd-fixture-ui"), { recursive: true });
  // The bench's own config, with its paths read against the copy (the copy can't resolve the config's imports).
  child = spawn(process.execPath, [cli, "mcp", "--root", root, "--config", join(repo, "test-bench/pattern-dump.config.ts")]);
  child.stdout.setEncoding("utf8").on("data", c => { stdout += c; });
  child.stderr.setEncoding("utf8").on("data", c => { stderr += c; });
}, 60_000);
afterAll(async () => {
  if (child && child.exitCode === null) child.kill();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const send = (message: object): void => { child.stdin.write(`${JSON.stringify(message)}\n`); };
/** Until `test` holds, or the deadline: the outcome a step waits for, named by its caller. */
async function until(test: () => boolean, what: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}\nstderr:\n${stderr}\nstdout:\n${stdout}`);
    await new Promise(r => setTimeout(r, 50));
  }
}
const answered = (id: number) => (): boolean => stdout.split("\n").some(l => l.includes(`"id":${id}`));

describe("pd mcp's stdout", () => {
  it("carries only protocol messages while pd dev starts, reloads after saves, and warns", async () => {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    await until(answered(1), "the answer to initialize");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    // The workbench's start lines have been printed by now, before the server answered, with test-bench's warnings: a
    // handle collision and a flattened cluster.
    expect(stderr).toContain("[dev-server] Ready in");
    expect(stderr).toContain("[dev-server] HANDLE_COLLISION");
    expect(stderr).toContain("[dev-server] FLATTENED");

    // A template saved (a reload line), a stylesheet saved (a CSS line), and a stylesheet that doesn't compile.
    const hbs = join(root, "src/patterns/atoms/button/button.hbs");
    await save(hbs, `${await readFile(hbs, "utf8")}\n`);
    const scss = join(root, "src/styles/01-atoms/button.scss");
    await save(scss, `${await readFile(scss, "utf8")}\n.df-button-extra { margin: 0; }\n`);
    const before = stderr.length;
    await save(join(root, "src/styles/01-atoms/broken.scss"), `.broken { color: ;\n`);
    await until(() => stderr.includes("Component changed") && stderr.includes("CSS updated"), "the reload lines of both saves");
    await until(() => stderr.slice(before).includes("recompiled: broken.scss"), "the line about broken.scss");

    // A tool call after the saves: its answer is on stdout too.
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "contract", arguments: { id: "atoms/button" } } });
    await until(answered(2), "the answer to a tool call");
    child.stdin.end();
    await new Promise(r => child.once("exit", r));

    const lines = stdout.split("\n").filter(l => l !== "");
    expect(lines.length).toBe(2);
    for (const line of lines) expect(JSON.parse(line), line).toMatchObject({ jsonrpc: "2.0" });
    // The start lines, the warnings and the reload lines reached the client as stderr, not on stdout.
    expect(stdout).not.toContain("[dev-server]");
  }, 90_000);
});
