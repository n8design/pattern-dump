// A removed source file leaves the running pd dev as a change updates it (CR-024): a component's stylesheet's CSS
// is no longer served, and a stylesheet that imported a removed partial shows its error; a removed theme is no
// longer served; a removed script answers 404. State, not events: what the server serves after the removal.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { componentCssUrl, scriptUrl, themeCssUrl } from "@pattern-dump/contracts";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  themes: { dir: "./themes", default: "light", switch: "attribute" },
  scriptsDir: "./src/scripts",
}), "site");

const FILES: Record<string, string> = {
  "src/patterns/atoms/chip/chip.hbs": `<span class="chip">chip</span>\n`,
  "src/patterns/atoms/card/card.hbs": `<div class="card">card</div>\n`,
  "src/styles/atoms/chip.scss": ".chip {\n  color: red;\n}\n",
  "src/styles/atoms/_tokens.scss": "$gap: 1rem;\n",
  "src/styles/atoms/card.scss": `@use "tokens";\n.card {\n  padding: tokens.$gap;\n}\n`,
  "themes/light.theme.scss": ":root {\n  --x: 1;\n}\n",
  "themes/dark.theme.scss": ":root {\n  --x: 2;\n}\n",
  "src/scripts/toggle.ts": `export const on = true;\n`,
};

async function project(open = "atoms/chip"): Promise<Bench> {
  const root = join(tmp, `p-${n++}`);
  for (const [rel, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  const b = new Bench(root, open);
  await b.start(config);
  return b;
}

const get = async (b: Bench, path: string) => {
  const res = await fetch(`${b.origin}${path}`);
  return { status: res.status, text: await res.text() };
};

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-watch-remove-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a removed file leaves pd dev", () => {
  it("a component's stylesheet: its CSS is no longer served, and the preview links none", async () => {
    const b = await project();
    expect((await get(b, componentCssUrl("atoms/chip"))).text).toContain(".chip");
    expect((await get(b, "/preview/atoms/chip")).text).toContain(componentCssUrl("atoms/chip"));
    await b.step(() => b.remove("src/styles/atoms/chip.scss"));
    const css = await get(b, componentCssUrl("atoms/chip"));
    expect(css.status).toBe(200);
    expect(css.text).toBe("");
    expect((await get(b, "/preview/atoms/chip")).text).not.toContain(componentCssUrl("atoms/chip"));
    await b.close();
  }, 60_000);

  it("a partial a stylesheet uses: that stylesheet's error is shown", async () => {
    const b = await project("atoms/card");
    const r = await b.step(() => b.remove("src/styles/atoms/_tokens.scss"));
    expect(r.messages.some(m => m.includes(`"type":"error"`) && m.includes("card.scss"))).toBe(true);
    await b.close();
  }, 60_000);

  it("a theme: no longer served", async () => {
    const b = await project();
    expect((await get(b, themeCssUrl("dark"))).status).toBe(200);
    await b.step(() => b.remove("themes/dark.theme.scss"));
    expect((await get(b, themeCssUrl("dark"))).status).toBe(404);
    expect((await get(b, themeCssUrl("light"))).status).toBe(200);
    await b.close();
  }, 60_000);

  it("a script: answers 404", async () => {
    const b = await project();
    expect((await get(b, scriptUrl("toggle"))).status).toBe(200);
    await b.step(() => b.remove("src/scripts/toggle.ts"));
    expect((await get(b, scriptUrl("toggle"))).status).toBe(404);
    await b.close();
  }, 60_000);
});
