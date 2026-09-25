// A class belongs to the rule that DEFINES it (the class on its own, without context), not to every
// rule that mentions it. A project base rule `.x .pkg-btn {}` must not take `pkg-btn` from the package
// component that defines it — otherwise that component's CSS is never linked where the class is used.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAllStyleData, patchClassOwnerIndex, selectorClasses } from "../src/style-index.js";

let project = "";
let pkg = "";
const ids = new Set(["atoms/pkg-btn", "atoms/card", "atoms/radio", "molecules/bar"]);

async function tree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), text);
  }
}

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), "pd-owner-project-"));
  pkg = await mkdtemp(join(tmpdir(), "pd-owner-pkg-"));
  await tree(project, {
    // A project base rule that only MENTIONS the package class in a descendant selector.
    "site.scss": `@use 'base/tile';\n`,
    "base/_tile.scss": `.x .pkg-btn { margin: 0; }\n.only-mentioned-host .only-mentioned { color: red; }\n`,
  });
  await tree(pkg, {
    "pkg.scss": `@use '01-atoms/pkg-btn';\n@use '01-atoms/radio';\n@use '02-molecules/bar';\n@use '01-atoms/card';\n`,
    "01-atoms/_pkg-btn.scss": `.pkg-btn { padding: 4px; }\n`,
    // `radio` is only ever mentioned before a combinator: it keeps a fallback owner.
    "01-atoms/_radio.scss": `.radio:checked + label { color: blue; }\n`,
    // bar (sorted before card) mentions `card` first; card defines it later and must still own it.
    "02-molecules/_bar.scss": `.bar .card { gap: 0; }\n`,
    "01-atoms/_card.scss": `.card { border: 1px solid; }\n`,
  });
});
afterAll(async () => {
  for (const dir of [project, pkg]) if (dir) await rm(dir, { recursive: true, force: true });
});

const projectRoot = () => ({ dir: project, entries: [join(project, "site.scss")] });
const packageRoot = () => ({ dir: pkg, entries: [join(pkg, "pkg.scss")] });

describe("selectorClasses", () => {
  it("a context-free compound defines its classes; context and pseudo arguments only mention", () => {
    expect(selectorClasses(".a.b:hover")).toEqual({ defines: ["a", "b"], mentions: [] });
    expect(selectorClasses(".a .b.c")).toEqual({ defines: [], mentions: ["a", "b", "c"] });
    expect(selectorClasses(".a:checked + label")).toEqual({ defines: [], mentions: ["a"] });
    expect(selectorClasses(".a:not(.b)")).toEqual({ defines: ["a"], mentions: ["b"] });
    expect(selectorClasses(".a, .b > .a")).toEqual({ defines: ["a"], mentions: ["b"] });
  });
});

describe("class ownership follows the defining rule", () => {
  it("a project base rule that mentions a package class does not own it (project root first)", async () => {
    const d = await buildAllStyleData([projectRoot(), packageRoot()], ids);
    expect(d.classOwnerIndex.get("pkg-btn")).toBe("atoms/pkg-btn");
  });

  it("the same holds with the package root first", async () => {
    const d = await buildAllStyleData([packageRoot(), projectRoot()], ids);
    expect(d.classOwnerIndex.get("pkg-btn")).toBe("atoms/pkg-btn");
  });

  it("a class that is only ever mentioned keeps its mentioning owner", async () => {
    const d = await buildAllStyleData([projectRoot(), packageRoot()], ids);
    expect(d.classOwnerIndex.get("radio")).toBe("atoms/radio");
    expect(d.classOwnerIndex.get("only-mentioned")).toBe("__base__");
    expect(d.classOwnerIndex.get("x")).toBe("__base__");
  });

  it("a component that defines a class wins over another component that mentioned it first", async () => {
    const d = await buildAllStyleData([packageRoot()], ids);
    expect(d.classOwnerIndex.get("card")).toBe("atoms/card");
    expect(d.classOwnerIndex.get("bar")).toBe("molecules/bar");
  });

  it("base provenance stays only on classes base still owns", async () => {
    const d = await buildAllStyleData([projectRoot(), packageRoot()], ids);
    expect(d.baseProvenance.has("pkg-btn")).toBe(false);
    expect(d.baseProvenance.get("x")).toBe("base/tile");
  });

  it("the per-save patch applies the same precedence", async () => {
    const d = await buildAllStyleData([projectRoot(), packageRoot()], ids);
    const index = d.classOwnerIndex;
    expect(await patchClassOwnerIndex(join(pkg, "pkg.scss"), "atoms/pkg-btn", pkg, ids, index)).toBe(true);
    expect(index.get("pkg-btn")).toBe("atoms/pkg-btn");
    expect(await patchClassOwnerIndex(join(pkg, "pkg.scss"), "molecules/bar", pkg, ids, index)).toBe(true);
    expect(index.get("card")).toBe("atoms/card");
  });
});
