// Cascade order survives bucketing. A repeated rule keeps its LAST position: the later copy is the one that wins the cascade, so
// dropping it (and keeping the earlier one) silently changes what the browser paints.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAllStyleData } from "../src/style-index.js";
import { recomputeComponentCss } from "../src/css-closure.js";

let styles = "";
const ids = new Set(["atoms/fieldset"]);

beforeAll(async () => {
  styles = await mkdtemp(join(tmpdir(), "pd-style-dedupe-"));
  const files: Record<string, string> = {
    // Base: A, B, then A again through a second @forward-style module — the order a project gets
    // when it forwards a package's modules after its own rules.
    "base.scss": `@use 'shared/pad';\n@use 'shared/reset';\n@use 'shared/pad-again';\n`,
    "shared/_pad.scss": `.fs { padding: 16px; }\n`,
    "shared/_reset.scss": `.fs { padding: 0; }\n`,
    "shared/_pad-again.scss": `@use 'pad';\n.fs { padding: 16px; }\n`,
    // Component: the same A, B, A sequence inside one component file.
    "comp.scss": `@use 'atoms/fieldset';\n`,
    "atoms/_fieldset.scss": `.fieldset { padding: 16px; }\n.fieldset { padding: 0; }\n.fieldset { padding: 16px; }\n`,
  };
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(styles, rel)), { recursive: true });
    await writeFile(join(styles, rel), text);
  }
});
afterAll(async () => { if (styles) await rm(styles, { recursive: true, force: true }); });

/** The padding values of `selector`'s rules, in stylesheet order. */
const paddings = (css: string, selector: string) =>
  [...css.matchAll(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{\\s*padding:\\s*([^;]+);`, "g"))].map(m => m[1]);

describe("repeated rules keep their last position", () => {
  it("base layer: A, B, A ends with A", async () => {
    const d = await buildAllStyleData([{ dir: styles, entries: [join(styles, "base.scss")] }], ids);
    expect(paddings(d.baseCss, ".fs")).toEqual(["0", "16px"]);
  });

  it("component bucket: A, B, A ends with A", async () => {
    const d = await buildAllStyleData([{ dir: styles, entries: [join(styles, "comp.scss")] }], ids);
    expect(paddings(d.componentCssMap.get("atoms/fieldset") ?? "", ".fieldset")).toEqual(["0", "16px"]);
  });

  it("per-save recompute matches the full build", async () => {
    const css = await recomputeComponentCss(join(styles, "comp.scss"), "atoms/fieldset", styles, ids);
    expect(paddings(css ?? "", ".fieldset")).toEqual(["0", "16px"]);
  });
});

describe("a configured entry list is the cascade order", () => {
  it("entries compile in the order given, not sorted", async () => {
    await writeFile(join(styles, "z-first.scss"), `.order { color: red; }\n`);
    await writeFile(join(styles, "a-second.scss"), `.order { color: blue; }\n`);
    const d = await buildAllStyleData(
      [{ dir: styles, entries: [join(styles, "z-first.scss"), join(styles, "a-second.scss")] }], ids);
    const colors = [...d.baseCss.matchAll(/\.order\s*\{\s*color:\s*([^;]+);/g)].map(m => m[1]);
    expect(colors).toEqual(["red", "blue"]);
  });
});
