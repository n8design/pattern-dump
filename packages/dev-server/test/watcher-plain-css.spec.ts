// A save to a plain `.css` file in the styles folder is handled as a `.scss` save: the component it belongs to
// serves the new rules, whether the file is an entry of its own or `@use`d by another stylesheet. Observed over HTTP
// after the watcher has handled the file (watch-harness.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let b: Bench;

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});

async function write(rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(tmp, rel)), { recursive: true });
  await save(join(tmp, rel), text);
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-watch-plain-css-"));
  await write("src/patterns/atoms/plain.hbs", `<span class="plain">P</span>\n`);
  await write("src/patterns/atoms/lonely.hbs", `<span class="lonely">L</span>\n`);
  await write("src/patterns/atoms/via.hbs", `<span class="via">{{> atoms-plain }}</span>\n`);
  await write("src/styles/atoms/via.scss", `@use "plain";\n.via { color: red; }\n`);
  await write("src/styles/atoms/plain.css", `.plain { color: blue; }\n`);
  await write("src/styles/atoms/lonely.css", `.lonely { color: green; }\n`);
  b = new Bench(tmp, "atoms/plain");
  await b.start(config);
}, 60_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const css = async (id: string): Promise<string> => (await fetch(`${b.origin}/_pd/components/${id}.css`)).text();

describe("a plain .css file in the styles folder, saved while pd dev runs", () => {
  it("serves its rules as its component's CSS from the start", async () => {
    expect(await css("atoms/plain")).toContain("color: blue");
    expect(await css("atoms/lonely")).toContain("color: green");
  });

  it("a save to a @use'd .css file reaches its component", async () => {
    await b.step(() => b.create("src/styles/atoms/plain.css", `.plain { color: purple; }\n`));
    expect(await css("atoms/plain")).toContain("color: purple");
    expect(await css("atoms/plain")).not.toContain("color: blue");
  });

  it("a save to a .css entry nothing loads reaches its component", async () => {
    await b.step(() => b.create("src/styles/atoms/lonely.css", `.lonely { color: olive; }\n`));
    expect(await css("atoms/lonely")).toContain("color: olive");
  });
});
