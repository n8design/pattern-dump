// The settle hook (watch.ts settle, served as POST /_pd/__test/settle with PD_TEST_HOOKS=1): it answers once
// every change made before it is handled, with its reload messages sent. Without the flag there is no such
// route; a barrier it writes reloads nothing; and pd build never copies a barrier into its output.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildStaticSite, type DevServer } from "@pattern-dump/dev-server";
import { startOnFreeWsPort } from "./free-ports.js";
import { save, saveInTwoSteps } from "../../../test-support/save.js";

const SETTLE = "/_pd/__test/settle";
const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
}), "settle");

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-settle-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
async function project(): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries({
    "src/patterns/atoms/chip/chip.hbs": "<p>one</p>\n", "src/styles/atoms/chip.scss": "p { margin: 0; }\n",
    "src/assets/dot.txt": "x\n",
  })) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  return root;
}

const servers: DevServer[] = [];
const sockets: WebSocket[] = [];
const hooks = process.env["PD_TEST_HOOKS"];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  for (const s of servers.splice(0)) await s.close();
  if (hooks === undefined) delete process.env["PD_TEST_HOOKS"]; else process.env["PD_TEST_HOOKS"] = hooks;
});

/** A live server on `root`, with the flag set or not, and the messages its socket sends. */
async function start(root: string, flag: boolean): Promise<{ origin: string; messages: string[] }> {
  if (flag) process.env["PD_TEST_HOOKS"] = "1"; else delete process.env["PD_TEST_HOOKS"];
  const { server, wsPort } = await startOnFreeWsPort(config, root);
  servers.push(server);
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  sockets.push(ws);
  const messages: string[] = [];
  ws.on("message", d => messages.push(String(d)));
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  return { origin: `http://127.0.0.1:${server.port}`, messages };
}
const settle = (origin: string) => fetch(`${origin}${SETTLE}`, { method: "POST" });
const reloads = (messages: string[]) => messages.filter(m => !m.startsWith(`{"type":"hello"`));

describe("the settle hook", () => {
  it("does not exist without PD_TEST_HOOKS=1", async () => {
    const { origin } = await start(await project(), false);
    expect((await settle(origin)).status).toBe(404);
  });

  it("answers once a change made just before it is handled, its reload sent", async () => {
    const root = await project();
    const { origin, messages } = await start(root, true);
    await saveInTwoSteps(join(root, "src/patterns/atoms/chip/chip.hbs"), "<p>two</p>\n");
    const res = await settle(origin);
    expect(res.status).toBe(204);
    // On the socket before the answer: the change was handled and its message sent first.
    expect(reloads(messages).map(m => (JSON.parse(m) as { type: string; componentId?: string })))
      .toContainEqual(expect.objectContaining({ type: "content-swap", componentId: "atoms/chip" }));
  });

  it("reloads nothing by itself: its barriers send no message", async () => {
    const { origin, messages } = await start(await project(), true);
    expect((await settle(origin)).status).toBe(204);
    expect((await settle(origin)).status).toBe(204);
    expect(reloads(messages)).toEqual([]);
  });

  it("answers only POST", async () => {
    const { origin } = await start(await project(), true);
    expect((await fetch(`${origin}${SETTLE}`)).status).toBe(405);
  });
});

describe("pd build", () => {
  it("leaves a barrier out of its output", async () => {
    const root = await project();
    await save(join(root, "src/assets/.__testOnly_barrier"), ".");
    const out = join(root, "..", `out-${n++}`);
    await buildStaticSite(config, root, { outDir: out, pdVersion: "0.0.0-test" });
    expect(existsSync(join(out, "assets", "dot.txt"))).toBe(true);
    const all = async (dir: string): Promise<string[]> =>
      (await readdir(dir, { recursive: true })).map(String);
    expect((await all(out)).filter(p => p.endsWith(".__testOnly_barrier"))).toEqual([]);
  }, 60_000);
});

