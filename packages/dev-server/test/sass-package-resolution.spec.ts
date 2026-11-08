// Project and package stylesheets can load an installed package by its bare name
// (`@use '@scope/pkg/...'`), found through node_modules from the stylesheet upward, as in Node.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileSassFile } from "@pattern-dump/build";
import { buildAllStyleData } from "../src/style-index.js";
import { recomputeComponentCss } from "../src/css-closure.js";
import { save } from "../../../test-support/save.js";

let root = "";
const ids = new Set(["atoms/tile"]);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-sass-pkg-"));
  const files: Record<string, string> = {
    "node_modules/@acme/tokens/package.json": `{ "name": "@acme/tokens", "version": "1.0.0" }\n`,
    "node_modules/@acme/tokens/sass/_colors.scss": `$brand: rgb(1, 2, 3);\n`,
    // A package whose own entry loads another installed package by name.
    "node_modules/acme-ui/package.json": `{ "name": "acme-ui", "version": "1.0.0" }\n`,
    "node_modules/acme-ui/sass/ui.scss": `@use '@acme/tokens/sass/colors';\n.ui { color: colors.$brand; }\n`,
    "styles/site.scss": `@use '@acme/tokens/sass/colors';\n@use 'atoms/tile';\n.site { color: colors.$brand; }\n`,
    "styles/atoms/_tile.scss": `@use '@acme/tokens/sass/colors';\n.tile { border-color: colors.$brand; }\n`,
  };
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("bare package names in @use", () => {
  it("a project stylesheet compiles and is attributed", async () => {
    const styles = join(root, "styles");
    const d = await buildAllStyleData([{ dir: styles, entries: [join(styles, "site.scss")] }], ids);
    expect(d.baseCss).toContain("rgb(1, 2, 3)");
    expect(d.componentCssMap.get("atoms/tile")).toContain("rgb(1, 2, 3)");
  });

  it("a package entry inside node_modules resolves another installed package", async () => {
    const pkg = join(root, "node_modules/acme-ui/sass");
    const d = await buildAllStyleData([{ dir: pkg, entries: [join(pkg, "ui.scss")] }], ids);
    expect(d.baseCss).toContain(".ui");
  });

  it("the per-save recompute and the build core resolve it too", async () => {
    const styles = join(root, "styles");
    expect(await recomputeComponentCss(join(styles, "site.scss"), "atoms/tile", styles, ids)).toContain("rgb(1, 2, 3)");
    expect(await compileSassFile(join(styles, "site.scss"))).toContain(".site");
  });
});
