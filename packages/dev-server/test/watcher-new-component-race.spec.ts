// A component whose stylesheet was saved before its template gets that stylesheet once the template arrives, even
// when a request builds the discovery (with the new template in it) before the watcher handles the template's add.
// Any request can: a render takes the current discovery and builds one when there is none. The watcher must then
// still see that the component set changed, and restyle (CI caught it in new-files.spec.ts on Linux).
//
// The add's handler is held (the watcher's test hook) while the discovery is dropped and a preview is requested,
// which is the order the race takes; then it is let go.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { previewUrl } from "@pattern-dump/contracts";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

type Hooks = {
  __testOnly_holdHandler?: (event: string, path: string) => Promise<void> | undefined;
  __testOnly_handler?: (event: string, path: string, api: { state: { discovery: { invalidate(): void } } }) => Promise<void> | undefined;
};
const hooks = globalThis as Hooks;

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-new-component-race-")); });
afterAll(async () => {
  delete hooks.__testOnly_holdHandler;
  delete hooks.__testOnly_handler;
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, documentBase: ["base"],
}), "site");

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await save(path, text);
}

describe("a new component's stylesheet, saved before its template", () => {
  it("moves to the component when a request built the discovery before the add was handled", async () => {
    const root = join(tmp, "site");
    await write(join(root, "src/patterns/atoms/btn/btn.hbs"), `<button class="btn">Hi</button>\n`);
    await write(join(root, "src/styles/atoms/btn.scss"), `.btn { color: red; }\n`);
    await write(join(root, "src/styles/base/reset.scss"), `body { margin: 0; }\n`);
    const b = new Bench(root, "atoms/btn");
    let state: { discovery: { invalidate(): void } } | undefined;
    hooks.__testOnly_handler = (_event, _path, api) => { state ??= api.state; return undefined; };
    await b.start(config);
    const get = async (p: string) => (await fetch(`${b.origin}${p}`)).text();

    // The stylesheet first: no component owns it yet, so its rules are in the base layer.
    await b.step(() => b.create("src/styles/atoms/zz.scss", `.zz { color: rgb(4 5 6); }\n`));
    expect(await get("/_pd/base.css")).toContain(".zz");
    expect(state).toBeDefined();

    // Then the template, its add held until a request has built a discovery that has it.
    let reached!: () => void;
    const turn = new Promise<void>(r => { reached = r; });
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    hooks.__testOnly_holdHandler = (event, path) => {
      if (event !== "add" || !path.endsWith("zz.hbs")) return undefined;
      reached();
      return held;
    };
    await b.step(async () => {
      await b.create("src/patterns/atoms/zz/zz.hbs", `<p class="zz">New</p>\n`);
      await turn;
      state!.discovery.invalidate();
      expect(await get(previewUrl("atoms/btn"))).toContain("Hi");
      release();
    });
    delete hooks.__testOnly_holdHandler;

    expect(await get("/_pd/base.css")).not.toContain(".zz");
    expect(await get("/_pd/components/atoms/zz.css")).toContain(".zz");
  }, 60_000);
});
