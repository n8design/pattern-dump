// A component added while pd dev runs gets its own stylesheet, however its files arrive. Until its
// template is discovered, a new stylesheet maps to no component, so its rules join the base layer
// (rules no component owns do); once the template is there, they are the component's, served as its
// CSS and gone from the base layer — without a restart.
//
// Runs against a small temp project, observed over HTTP (the served CSS).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { mkdir, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";
import { save } from "../../../test-support/save.js";

const config = defineConfig({
  sourceDir:    "./src",
  patternsDir:  "./src/patterns",
  outDir:       "./dist",
  styles:       { strategy: "parallel", dir: "./src/styles" },
  documentBase: ["base"],
});

describe("file watcher — a component added while it runs", () => {
  let dir = "";
  let server: { port: number; close: () => Promise<void> };

  const get = async (p: string) => (await fetch(`http://127.0.0.1:${server.port}${p}`)).text();
  const write = async (rel: string, text: string) => {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await save(join(dir, rel), text);
  };
  /** Poll until `pred` holds (or time out), returning the last observation either way. */
  const settle = async <T>(read: () => Promise<T>, pred: (v: T) => boolean): Promise<T> => {
    const deadline = Date.now() + 10_000;
    let v = await read();
    while (!pred(v) && Date.now() < deadline) { await new Promise(r => setTimeout(r, 100)); v = await read(); }
    return v;
  };
  const owner = async (cls: string) => ({
    base: (await get("/_pd/base.css")).includes(`.${cls}`),
    own: (await get(`/_pd/components/atoms/${cls}.css`)).includes(`.${cls}`),
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pd-new-component-"));
    await write("src/patterns/atoms/btn.hbs", `<button class="btn">Hi</button>\n`);
    await write("src/styles/atoms/btn.scss", `.btn { color: red; }\n`);
    await write("src/styles/base/reset.scss", `body { margin: 0; }\n`);
    server = await startDevServer(config, dir, { port: 0, wsPort: 0 });
    await get("/api/component/atoms/btn");
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("stylesheet first, template after: the rules leave the base layer for the component", async () => {
    await write("src/styles/atoms/badge.scss", `.badge { color: rgb(4 5 6); }\n`);
    // No component owns it yet, so its rules are base-layer rules.
    expect(await settle(() => owner("badge"), o => o.base)).toEqual({ base: true, own: false });

    await write("src/patterns/atoms/badge.hbs", `<span class="badge">New</span>\n`);
    expect(await settle(() => owner("badge"), o => o.own && !o.base)).toEqual({ base: false, own: true });
  }, 30_000);

  it("stylesheet and template together: the rules are the component's", async () => {
    await Promise.all([
      write("src/patterns/atoms/chip.hbs", `<span class="chip">New</span>\n`),
      write("src/styles/atoms/chip.scss", `.chip { color: rgb(7 8 9); }\n`),
    ]);
    expect(await settle(() => owner("chip"), o => o.own && !o.base)).toEqual({ base: false, own: true });
  }, 30_000);
});
