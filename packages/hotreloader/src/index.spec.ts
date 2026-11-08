// The hotreloader's connection behaviour, over a real socket.
//
// Colocated in src/ (like contracts) so the package tsconfig typechecks it.

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { PD_PROTOCOL_VERSION, type HmrMessage } from "@pattern-dump/contracts";
import { createHotReloader, type HotReloader } from "./index.js";

let hr: HotReloader | undefined;
afterEach(async () => { await hr?.close(); hr = undefined; });

const collision = (handle: string): HmrMessage =>
  ({ type: "collision", handle, incumbentPath: `/a/${handle}.hbs`, quarantinedPath: `/b/${handle}.hbs` });

/** Connect, and resolve with the first `count` frames the server sends. */
function firstFrames(port: number, count: number): Promise<HmrMessage[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: HmrMessage[] = [];
    const timer = setTimeout(() => { ws.close(); resolve(got); }, 1500);
    ws.on("message", data => {
      got.push(JSON.parse(String(data)) as HmrMessage);
      if (got.length === count) { clearTimeout(timer); ws.close(); resolve(got); }
    });
    ws.on("error", reject);
  });
}

describe("createHotReloader — on connect", () => {
  it("sends hello, then the retained messages, to a client that connects later", async () => {
    hr = createHotReloader(45_301);
    hr.retain([collision("atoms-x"), collision("atoms-y")]);
    const frames = await firstFrames(hr.port, 3);
    expect(frames).toEqual([
      { type: "hello", protocol: PD_PROTOCOL_VERSION, generation: expect.stringMatching(/^[0-9a-f]{8}\.0$/) },
      collision("atoms-x"),
      collision("atoms-y"),
    ]);
  });

  it("retain replaces the set — a cleared set replays nothing", async () => {
    hr = createHotReloader(45_302);
    hr.retain([collision("atoms-x")]);
    hr.retain([]);
    const frames = await firstFrames(hr.port, 2);
    expect(frames).toEqual([{ type: "hello", protocol: PD_PROTOCOL_VERSION, generation: expect.stringMatching(/^[0-9a-f]{8}\.0$/) }]);
  });
});

describe("createHotReloader — the live-reload generation", () => {
  it("moves on with each reload message, which carries it, and hello tells a later client the current one", async () => {
    hr = createHotReloader(45_304);
    await hr.listening;
    const start = hr.generation();
    expect(start).toMatch(/^[0-9a-f]{8}\.0$/);
    const boot = start.split(".")[0];
    // A reload message moves it; a collision (a standing condition, not a reload) does not.
    hr.push({ type: "content-swap", componentId: "atoms/x" });
    hr.push(collision("atoms-x"));
    hr.push({ type: "page-changed", route: null });
    expect(hr.generation()).toBe(`${boot}.2`);
    const frames = await firstFrames(hr.port, 1);
    expect(frames).toEqual([{ type: "hello", protocol: PD_PROTOCOL_VERSION, generation: `${boot}.2` }]);
  });

  it("is stamped on the reload messages a connected client receives", async () => {
    const server = createHotReloader(45_305);
    hr = server;
    await server.listening;
    const boot = server.generation().split(".")[0];
    const got = new Promise<HmrMessage[]>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      const frames: HmrMessage[] = [];
      ws.on("message", data => {
        frames.push(JSON.parse(String(data)) as HmrMessage);
        if (frames.length === 1) {
          server.push({ type: "css-link-swap", componentId: "atoms/x", href: "/x.css" });
          server.push({ type: "tree-changed" });
        }
        if (frames.length === 3) { ws.close(); resolve(frames); }
      });
      ws.on("error", reject);
    });
    expect((await got).slice(1)).toEqual([
      { type: "css-link-swap", componentId: "atoms/x", href: "/x.css", generation: `${boot}.1` },
      { type: "tree-changed", generation: `${boot}.2` },
    ]);
  });
});

describe("createHotReloader — binding", () => {
  it("resolves listening once bound, and rejects (without crashing) when the port is taken", async () => {
    hr = createHotReloader(45_303);
    await expect(hr.listening).resolves.toBeUndefined();
    const second = createHotReloader(45_303);
    await expect(second.listening).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
