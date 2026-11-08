// The component on screen, as the watcher knows it (`lastComponentId`), is set only by a component that
// exists. The workbench asks /api/component/<path> for any route its tree does not know; that 404 must not
// redirect the next reload away from the component that is open.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { Bench, closeAll } from "./watch-harness.js";

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, dataDir: "./src/_data",
});

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-last-component-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a request for a component that does not exist", () => {
  it("answers 404, and the next reload still names the component that is open", async () => {
    const root = join(tmp, "site");
    for (const [rel, text] of [
      ["src/patterns/atoms/btn/btn.hbs", `<button class="btn">{{site}}</button>\n`],
      ["src/_data/site.json", `{ "site": "one" }\n`],
    ]) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await writeFile(join(root, rel), text);
    }
    await mkdir(join(root, "src/styles"), { recursive: true });
    const b = new Bench(root, "atoms/btn", join(tmp, "staging"));
    await b.start(config);

    const r = await b.step(async () => {
      const probe = await fetch(`${b.origin}/api/component/atoms/no-such-thing`);
      expect(probe.status).toBe(404);
      await writeFile(b.at("src/_data/site.json"), `{ "site": "two" }\n`);
    }, [["change", "src/_data/site.json"]]);
    expect(r.messages).toEqual([`{"type":"content-swap","componentId":"atoms/btn"}`]);
  }, 60_000);
});
