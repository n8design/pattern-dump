// Statement at-rules (`@import`, `@layer a, b`, …) have no block, and PostCSS writes their
// terminating `;` from the parent. Serialising top-level nodes one by one must keep it, or the
// next rule is parsed into the at-rule's prelude and the browser drops both.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postcss from "postcss";
import { buildAllStyleData } from "../src/style-index.js";
import { recomputeComponentCss } from "../src/css-closure.js";
import { save } from "../../../test-support/save.js";

const componentIds = new Set(["atoms/button"]);
let stylesDir: string;

/** Top-level shape of a stylesheet as the browser would parse it. */
function topLevel(css: string): string[] {
  return postcss.parse(css).nodes.map(n =>
    n.type === "rule" ? `rule ${n.selector}`
      : n.type === "atrule" ? `@${n.name}${n.nodes ? " {}" : ""}`
        : n.type);
}

beforeAll(async () => {
  stylesDir = await mkdtemp(join(tmpdir(), "pd-statement-at-rules-"));
  await mkdir(join(stylesDir, "atoms"), { recursive: true });
  await save(join(stylesDir, "base.scss"),
    `body { margin: 0; }\n@import url("https://fonts.example/a.css");\n.page { color: red; }\n`);
  await save(join(stylesDir, "atoms", "button.scss"),
    `@layer reset, components;\n.btn { color: blue; }\n@layer components { .btn--x { color: green; } }\n`);
});

afterAll(async () => { await rm(stylesDir, { recursive: true, force: true }); });

describe("statement at-rules survive CSS bucketing", () => {
  it("base layer keeps @import terminated and hoisted, and no rule is swallowed", async () => {
    const { baseCss } = await buildAllStyleData(stylesDir, componentIds);
    expect(topLevel(baseCss)).toEqual(["@import", "rule body", "rule .page"]);
  });

  it("component bucket keeps a statement @layer terminated", async () => {
    const { componentCssMap } = await buildAllStyleData(stylesDir, componentIds);
    expect(topLevel(componentCssMap.get("atoms/button") ?? ""))
      .toEqual(["@layer", "rule .btn", "@layer {}"]);
  });

  it("the HMR recompute path serialises the same way", async () => {
    const css = await recomputeComponentCss(
      join(stylesDir, "atoms", "button.scss"), "atoms/button", stylesDir, componentIds);
    expect(topLevel(css ?? "")).toEqual(["@layer", "rule .btn", "@layer {}"]);
  });
});
