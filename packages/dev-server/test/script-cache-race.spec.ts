// A script saved while it compiles: the compile from before the save is never stored or served; the
// request gets the compile after it (lazy.ts). The save is made inside the test-only hook
// `__testOnly_onLazy` at the moment the first compile finishes, on a server with no watcher, so the only
// invalidation is the one the test makes.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

type LazyHook = (name: string, phase: "built" | "taken", invalidate: () => void) => void | Promise<void>;
const hooks = globalThis as { __testOnly_onLazy?: LazyHook };

let tmp = "";
let server: DevServer;
const script = () => join(tmp, "site/src/scripts/toggle.ts");
const get = async () => (await fetch(`http://127.0.0.1:${server.port}/_pd/scripts/toggle.js`)).text();

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await save(path, text);
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-script-race-"));
  const root = join(tmp, "site");
  await write(join(root, "src/patterns/atoms/btn/btn.hbs"), `<button class="btn">Hi</button>\n`);
  await mkdir(join(root, "src/styles"), { recursive: true });
  await write(script(), `console.log("before the save");\n`);
  server = await startDevServer(validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" }, scriptsDir: "./src/scripts",
  }), "site"), root, { port: 0, live: false });
}, 60_000);
afterEach(() => { delete hooks.__testOnly_onLazy; });
afterAll(async () => {
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a script saved while it compiles", () => {
  it("is served as saved: the compile from before the save is never stored or served", async () => {
    let saved = false;
    hooks.__testOnly_onLazy = async (name, phase, invalidate) => {
      if (name !== "script:toggle" || phase !== "built" || saved) return;
      saved = true;
      await save(script(), `console.log("after the save");\n`);
      invalidate();
    };
    const during = await get();
    expect(saved).toBe(true);
    expect(during).toContain("after the save");
    expect(during).not.toContain("before the save");

    delete hooks.__testOnly_onLazy;
    expect(await get()).toContain("after the save");
  }, 30_000);

  it("answers 404 for a script that does not exist, and still serves it once it does", async () => {
    const missing = await fetch(`http://127.0.0.1:${server.port}/_pd/scripts/later.js`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toMatch(/^No script "later": scripts are TypeScript, so later\.ts is expected in /);
    await write(join(tmp, "site/src/scripts/later.ts"), `console.log("later");\n`);
    const found = await fetch(`http://127.0.0.1:${server.port}/_pd/scripts/later.js`);
    expect(found.status).toBe(200);
    expect(await found.text()).toContain("later");
  }, 30_000);
});
