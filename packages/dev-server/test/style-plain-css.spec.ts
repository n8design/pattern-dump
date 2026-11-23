// A plain `.css` file in the styles folder is a stylesheet as a `.scss` file is: Sass reads it (`@use "plain"` loads
// `plain.css`), so its rules belong to the component it is named after, and one that nothing loads is an entry of its
// own. Before, a `@use`d `.css` file owned nothing (its rules went to the base layer and painted in no preview), and
// one that nothing loaded was never compiled.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectScssFiles } from "@pattern-dump/build";
import { buildAllStyleData, resolveScssToComponent, resolveSharedModulePath } from "../src/style-index.js";
import { save } from "../../../test-support/save.js";

let styles = "";
const ids = new Set(["atoms/plain", "atoms/via", "atoms/lonely"]);

beforeAll(async () => {
  styles = await mkdtemp(join(tmpdir(), "pd-plain-css-"));
  const files: Record<string, string> = {
    "atoms/via.scss": `@use "plain";\n.via { color: red; }\n`,
    "atoms/plain.css": `.plain { color: blue; }\n`,
    "atoms/lonely.css": `.lonely { color: green; }\n`,
    "base/_shared.css": `.shared { margin: 0; }\n`,
  };
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(styles, rel)), { recursive: true });
    await save(join(styles, rel), text);
  }
});
afterAll(async () => { if (styles) await rm(styles, { recursive: true, force: true }); });

describe("plain .css in the styles folder", () => {
  it("belongs to the component it is named after, as a .scss file does", () => {
    expect(resolveScssToComponent(join(styles, "atoms/plain.css"), styles, ids)).toBe("atoms/plain");
    expect(resolveSharedModulePath(join(styles, "base/_shared.css"), styles, true)).toBe("base/shared");
  });

  it("a non-partial .css file is an entry; a partial is not", async () => {
    const entries = (await collectScssFiles(styles)).map(f => f.slice(styles.length + 1)).sort();
    expect(entries).toEqual(["atoms/lonely.css", "atoms/plain.css", "atoms/via.scss"]);
  });

  it("its classes are owned by that component and its rules are that component's CSS, not the base layer", async () => {
    const d = await buildAllStyleData(styles, ids);
    expect(d.classOwnerIndex.get("plain")).toBe("atoms/plain");
    expect(d.classOwnerIndex.get("lonely")).toBe("atoms/lonely");
    expect(d.componentCssMap.get("atoms/plain")).toContain(".plain");
    expect(d.componentCssMap.get("atoms/lonely")).toContain(".lonely");
    expect(d.baseCss).not.toContain(".plain");
    // The component that loads it lists it as a dependency by its component's path, as for a .scss file.
    expect(d.scssModuleGraph.styleUsesModules.get("atoms/via")).toEqual(["atoms/plain"]);
  });
});
