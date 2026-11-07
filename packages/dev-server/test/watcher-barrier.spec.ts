// The watcher's test-only barrier file, `.__testOnly_barrier`, is ignored completely when no test hook is
// set: no handler runs for it, no message is sent and nothing is logged. Placed in a helpers folder, where
// any other file asks for a restart. This spec does not use watch-harness.ts, which sets the hook.
//
// With no hook there is no "handled" signal, so the barrier file's edit is followed by an edit to the
// helper module in the same folder (the OS reports one folder's changes in order) and the step waits for
// that one's reload message; whatever the barrier's edit caused would come before it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";

let tmp = "";
let server: DevServer;
let ws: WebSocket;
const messages: string[] = [];

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});
async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
/** Resolve on the next message matching `test`, or fail after 5 s naming what arrived. */
const next = (test: (m: string) => boolean): Promise<void> => new Promise((resolve, reject) => {
  const from = messages.length;
  const timer = setTimeout(() => reject(new Error(`no matching message within 5000 ms; got ${JSON.stringify(messages.slice(from))}`)), 5_000);
  const on = (d: Buffer) => { if (test(String(d))) { clearTimeout(timer); ws.off("message", on); resolve(); } };
  ws.on("message", on);
});

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-barrier-"));
  const root = join(tmp, "site");
  await write(join(root, "src/patterns/atoms/loud/loud.hbs"), `<p>{{shout "x"}}</p>\n`);
  await mkdir(join(root, "src/styles"), { recursive: true });
  await write(join(root, "src/helpers/shout.js"), `export function shout(s) { return s; }\n`);
  await write(join(root, "src/helpers/.__testOnly_barrier"), "");
  const wsPort = await freePort();
  server = await startDevServer(validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" }, helpers: "./src/helpers",
  }), "site"), root, { port: 0, wsPort });
  ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  ws.on("message", (d: Buffer) => messages.push(String(d)));
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/loud`);
}, 60_000);
afterAll(async () => {
  ws?.close();
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("the barrier file, with no test hook set", () => {
  it("is ignored: no handler, no message, no log line", async () => {
    expect((globalThis as { __testOnly_onEventHandled?: unknown }).__testOnly_onEventHandled).toBeUndefined();
    const lines: string[] = [];
    const spies = (["log", "warn", "error"] as const).map(k => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); }));
    try {
      for (let round = 0; round < 2; round++) {
        const from = messages.length;
        const reloaded = next(m => m.includes(`"content-swap"`));
        await appendFile(join(tmp, "site/src/helpers/.__testOnly_barrier"), ".");
        await appendFile(join(tmp, "site/src/helpers/shout.js"), "\n");
        await reloaded;
        expect(messages.slice(from).filter(m => !m.startsWith('{"type":"hello"'))).toEqual([`{"type":"content-swap","componentId":"atoms/loud"}`]);
      }
    } finally {
      spies.forEach(s => s.mockRestore());
    }
    expect(lines.filter(l => l.includes("__testOnly_barrier"))).toEqual([]);
    expect(lines.filter(l => l.includes("Helper changed: src/helpers/shout.js"))).toHaveLength(2);
  }, 30_000);
});
