// A component's stylesheet whose rules a mixin writes: the rules' owner is the partial holding the mixin, which no
// component owns, so they are base-layer rules. When a save moves them into the component's own file, the base
// layer loses them at once, and the component gains them: pd dev doesn't keep the orphaned rules until a restart.
// The reverse (a save that starts including the mixin) puts them back. Observed over HTTP once the watcher has
// handled the save (watch-harness.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let b: Bench;

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
}), "test");

const MIXIN = `@mixin palette($name) {\n  .swatch-#{$name} { color: rgb(1, 2, 3); }\n}\n`;
const VIA_MIXIN = `@use "../mixins" as m;\n.swatch { display: block; }\n@include m.palette("retro");\n`;
const OWN = `.swatch { display: block; }\n.swatch-retro { color: rgb(1, 2, 3); }\n`;

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await save(path, text);
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-base-orphans-"));
  await write(join(tmp, "src/patterns/atoms/swatch/swatch.hbs"), `<span class="swatch swatch-retro">Retro</span>\n`);
  await write(join(tmp, "src/styles/_mixins.scss"), MIXIN);
  await write(join(tmp, "src/styles/atoms/swatch.scss"), VIA_MIXIN);
  b = new Bench(tmp, "atoms/swatch");
  await b.start(config);
}, 60_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const served = async (path: string): Promise<string> => (await fetch(`${b.origin}${path}`)).text();
const baseCss = () => served("/_pd/base.css");
const swatchCss = () => served("/_pd/components/atoms/swatch.css");

describe("base-layer rules a component's stylesheet writes through a mixin", () => {
  it("start in the base layer, not the component's CSS", async () => {
    expect(await baseCss()).toContain(".swatch-retro");
    expect(await swatchCss()).not.toContain(".swatch-retro");
  });

  it("leave the base layer as soon as a save writes them in the component's own file", async () => {
    await b.step(() => b.create("src/styles/atoms/swatch.scss", OWN));
    expect(await baseCss()).not.toContain(".swatch-retro");
    expect(await swatchCss()).toContain(".swatch-retro");
  });

  it("come back to the base layer when a save includes the mixin again", async () => {
    await b.step(() => b.create("src/styles/atoms/swatch.scss", VIA_MIXIN));
    expect(await baseCss()).toContain(".swatch-retro");
    expect(await swatchCss()).not.toContain(".swatch-retro");
  });
});
