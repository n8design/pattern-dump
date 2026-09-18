// The watcher's full-restyle path: a recompiled SCSS file that maps to no component — a
// `styles.entry` bundle, or the file importing an edited base partial — must still reach the
// preview. Before this path existed such a save updated nothing until the next navigation.
//
// Runs against a small temp project with one entry bundle and a base layer, observed over HTTP
// (the served CSS) and over a real socket (the broadcasts dev-ui acts on).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { readFile, writeFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import WebSocket from "ws";

import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";

const WS_PORT = 47_312;

const config = defineConfig({
  sourceDir:    "./src",
  patternsDir:  "./src/patterns",
  outDir:       "./dist",
  styles:       { strategy: "parallel", dir: "./src/styles", entry: "styles.scss" },
  assets:       { strategy: "central", dir: "./assets" },
  documentBase: ["base/reset"],
});

interface HmrMessage { type: string; componentId?: string; href?: string; message?: string }

describe("file watcher — full restyle for an entry bundle and the base layer", () => {
  let dir = "";
  let server: { port: number; close: () => Promise<void> };
  let ws: WebSocket;
  const received: HmrMessage[] = [];

  const get = async (p: string) => (await fetch(`http://127.0.0.1:${server.port}${p}`)).text();
  const write = (rel: string, text: string) => writeFile(join(dir, rel), text, "utf-8");
  const waitFor = async (pred: (m: HmrMessage) => boolean, label: string): Promise<HmrMessage> => {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const hit = received.find(pred);
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for ${label}; received: ${JSON.stringify(received)}`);
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pd-restyle-"));
    await mkdir(join(dir, "src/patterns/atoms"), { recursive: true });
    await mkdir(join(dir, "src/styles/base"), { recursive: true });
    await mkdir(join(dir, "src/styles/atoms"), { recursive: true });
    await mkdir(join(dir, "assets"), { recursive: true });
    await write("src/patterns/atoms/btn.hbs", `<button class="btn">Hi</button>\n`);
    await write("src/patterns/atoms/tag.hbs", `<span class="tag">Tag</span>\n`);
    await write("src/styles/base/_reset.scss", `body { margin: 0; }\n`);
    await write("src/styles/atoms/_btn.scss", `.btn { color: red; }\n`);
    await write("src/styles/atoms/_tag.scss", `.tag { color: gray; }\n`);
    await write("src/styles/styles.scss", `@use 'base/reset';\n@use 'atoms/btn';\n@use 'atoms/tag';\n`);

    server = await startDevServer(config, dir, { port: 0, wsPort: WS_PORT });
    ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    ws.on("message", raw => { try { received.push(JSON.parse(String(raw)) as HmrMessage); } catch { /* not ours */ } });
    await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
    // Put atoms/btn on screen: the watcher refreshes the component the last detail request named.
    await get("/api/component/atoms/btn");
  }, 60_000);

  afterAll(async () => {
    ws?.close();
    await server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("a component partial edit updates that component's CSS and swaps only its link", async () => {
    received.length = 0;
    await write("src/styles/atoms/_btn.scss", `.btn { color: blue; }\n`);

    const msg = await waitFor(m => m.type === "css-link-swap", "css-link-swap");
    expect(msg.componentId).toBe("atoms/btn");
    expect(msg.href).toContain("/_pd/components/atoms/btn.css?v=");
    expect(await get("/_pd/components/atoms/btn.css")).toContain("color: blue");
    // Nothing else changed, so nothing else is swapped and the preview is not reloaded.
    expect(received.filter(m => m.type === "css-link-swap").map(m => m.componentId)).toEqual(["atoms/btn"]);
    expect(received.some(m => m.type === "content-swap")).toBe(false);
  }, 60_000);

  it("a base partial edit updates /_pd/base.css and reloads the preview with a new base link", async () => {
    const before = await get("/preview/atoms/btn");
    expect(before).toContain(`href="/_pd/base.css"`);

    received.length = 0;
    await write("src/styles/base/_reset.scss", `body { margin: 0; padding: 3px; }\n`);

    const msg = await waitFor(m => m.type === "content-swap", "content-swap");
    expect(msg.componentId).toBe("atoms/btn");
    expect(await get("/_pd/base.css")).toContain("padding: 3px");
    // The reloaded document names a new base URL, so the browser cannot reuse the old sheet.
    expect(await get("/preview/atoms/btn")).toContain(`href="/_pd/base.css?v=1"`);
    expect(received.some(m => m.type === "css-link-swap")).toBe(false);
  }, 60_000);

  it("a compile error keeps the last good CSS instead of emptying every component", async () => {
    received.length = 0;
    await write("src/styles/atoms/_tag.scss", `.tag { color: gray;\n`);

    await waitFor(m => m.type === "error", "error");
    expect(await get("/_pd/components/atoms/btn.css")).toContain("color: blue");
    expect(await get("/_pd/components/atoms/tag.css")).toContain("color: gray");
    expect(await get("/_pd/base.css")).toContain("padding: 3px");

    await write("src/styles/atoms/_tag.scss", `.tag { color: gray; }\n`);
  }, 60_000);
});
