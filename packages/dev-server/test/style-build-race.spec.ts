// A stylesheet saved while a request's full style build is in flight: the save's patch wins, that build
// (started before the save) is never installed, and the full build the request then gets starts after the
// patch, so the module graph (`styleUsesModules`) has the saved file's new @use and the served CSS is the
// saved one (server-state.ts, hazard 5). The moment is the test-only hook `__testOnly_onLazy("style",
// "built")`; the save is handled by the real watcher before the hook returns (watch-harness.ts).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

type LazyHook = (name: string, phase: "built" | "taken", invalidate: () => void) => void | Promise<void>;
const hooks = globalThis as { __testOnly_onLazy?: LazyHook };

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});
const SCSS = "src/styles/atoms/c.scss";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-style-race-")); });
afterEach(() => { delete hooks.__testOnly_onLazy; });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

type Detail = { relationships: { styleUsesModules?: string[] } };

describe("a stylesheet saved during a request's full style build", () => {
  it("wins: that build is never installed, and the request gets one started after the save", async () => {
    const root = join(tmp, "site");
    for (const [rel, text] of [
      ["src/patterns/atoms/c/c.hbs", `<p class="c">c</p>\n`],
      [SCSS, `.c {\n  color: red;\n}\n`],
      ["src/styles/base/_tokens.scss", `$ink: rgb(1 2 3);\n`],
    ]) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await save(join(root, rel), text);
    }
    const b = new Bench(root, "atoms/c");
    await b.start(config);
    const detail = async () => (await fetch(`${b.origin}/api/component/atoms/c`)).json() as Promise<Detail>;
    const css = async () => (await fetch(`${b.origin}/_pd/components/atoms/c.css`)).text();

    // A first save leaves the full build to the next request.
    await b.step(() => save(b.at(SCSS), `.c {\n  color: blue;\n}\n`), [["change", SCSS]]);

    // That request's build runs; when it finishes, before it is stored, the stylesheet gains a @use and the
    // watcher handles the save.
    let builds = 0;
    hooks.__testOnly_onLazy = async (name, phase) => {
      if (name !== "style" || phase !== "built") return;
      builds++;
      if (builds > 1) return;
      const from = handled.length;
      await save(b.at(SCSS), `@use "../base/tokens";\n.c {\n  color: tokens.$ink;\n}\n`);
      await whenHandled(() => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === SCSS));
    };
    const during = await detail();
    // The build from before the save was not installed: the request got a second one, which has the @use.
    expect(builds).toBe(2);
    expect(during.relationships.styleUsesModules).toEqual(["base/tokens"]);
    expect(await css()).toContain("color: rgb(1, 2, 3)");

    // And it is stored: the next request builds nothing.
    delete hooks.__testOnly_onLazy;
    let later = 0;
    hooks.__testOnly_onLazy = (name, phase) => { if (name === "style" && phase === "built") later++; };
    expect((await detail()).relationships.styleUsesModules).toEqual(["base/tokens"]);
    expect(later).toBe(0);
  }, 60_000);
});
