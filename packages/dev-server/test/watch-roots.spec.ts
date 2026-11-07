// The watcher finds a file's source root by folder boundary: a project root, a package root, and a
// sibling folder whose name starts the same, which is in neither.
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { rootMatchers, within } from "../src/watch-roots.js";

const project = "/site/src";
const pkg = "/site/vendor/ds";
const m = rootMatchers({
  patterns: [join(project, "patterns"), join(pkg, "patterns")],
  styles: [
    { dir: join(project, "styles"), inBase: p => p.includes("/styles/site/") },
    { dir: join(pkg, "styles"), inBase: p => p.includes("/styles/base/") },
  ],
  themes: [join(pkg, "themes")],
  scripts: [join(project, "scripts")],
});

describe("within", () => {
  it("is the folder itself or inside it, never a sibling that starts the same", () => {
    expect([within("/a/patterns", "/a/patterns"), within("/a/patterns", "/a/patterns/x.hbs"), within("/a/patterns", "/a/patterns-site/x.md")])
      .toEqual([true, true, false]);
  });
});

describe("rootMatchers", () => {
  it("finds a file's root, the project's or a package's", () => {
    expect(m.patternRootOf(join(project, "patterns", "atoms", "a.hbs"))).toBe(join(project, "patterns"));
    expect(m.patternRootOf(join(pkg, "patterns", "atoms", "a.hbs"))).toBe(join(pkg, "patterns"));
    expect(m.themeDirOf(join(pkg, "themes", "light.theme.scss"))).toBe(join(pkg, "themes"));
    expect(m.scriptDirOf(join(project, "scripts", "toggle.ts"))).toBe(join(project, "scripts"));
  });

  it("finds none for a sibling folder that starts the same", () => {
    expect(m.patternRootOf(join(project, "patterns-site", "a.md"))).toBeUndefined();
    expect(m.styleRootOf(join(project, "styles-old", "a.scss"))).toBeUndefined();
    expect(m.scriptDirOf(join(project, "scripts2", "a.ts"))).toBeUndefined();
  });

  it("asks a stylesheet's own root whether it is base layer", () => {
    expect(m.inBase(join(project, "styles", "site", "tokens.scss"))).toBe(true);
    expect(m.inBase(join(pkg, "styles", "base", "reset.scss"))).toBe(true);
    // The package's base folder name means nothing to the project's root, and the reverse.
    expect(m.inBase(join(project, "styles", "base", "x.scss"))).toBe(false);
    expect(m.inBase(join(pkg, "styles", "site", "x.scss"))).toBe(false);
  });

  it("resolves a stylesheet to its component against its own root", () => {
    const ids = new Set(["atoms/chip"]);
    expect(m.componentOfScss(join(project, "styles", "atoms", "chip.scss"), ids)).toBe("atoms/chip");
    expect(m.componentOfScss(join(pkg, "styles", "atoms", "chip.scss"), ids)).toBe("atoms/chip");
    expect(m.componentOfScss(join(project, "elsewhere", "atoms", "chip.scss"), ids)).toBeNull();
  });
});
