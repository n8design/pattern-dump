// resolveScssToComponent: which component a styles-tree file belongs to. PatternLab projects number
// their folders (`00-atoms`); the prefix orders the tree and may appear on either side, the patterns
// tree or the styles tree, or both.
import { describe, it, expect } from "vitest";
import { resolveScssToComponent } from "../src/style-index.js";

const styles = "/p/src/styles";
const at = (rel: string) => `${styles}/${rel}`;

describe("resolveScssToComponent", () => {
  it("unnumbered patterns, numbered styles (test-bench, hTWOo)", () => {
    const ids = new Set(["atoms/button", "molecules/field"]);
    expect(resolveScssToComponent(at("01-atoms/button.scss"), styles, ids)).toBe("atoms/button");
    expect(resolveScssToComponent(at("02-molecules/_field.scss"), styles, ids)).toBe("molecules/field");
  });

  it("numbered patterns, numbered styles", () => {
    const ids = new Set(["00-atoms/badge", "01-molecules/card"]);
    expect(resolveScssToComponent(at("00-atoms/_badge.scss"), styles, ids)).toBe("00-atoms/badge");
    expect(resolveScssToComponent(at("01-molecules/card/_index.scss"), styles, ids)).toBe("01-molecules/card");
  });

  it("numbered patterns, unnumbered styles", () => {
    const ids = new Set(["00-atoms/badge"]);
    expect(resolveScssToComponent(at("atoms/_badge.scss"), styles, ids)).toBe("00-atoms/badge");
  });

  it("numbered patterns, differently numbered styles", () => {
    const ids = new Set(["01-atoms/badge"]);
    expect(resolveScssToComponent(at("00-atoms/_badge.scss"), styles, ids)).toBe("01-atoms/badge");
  });

  it("an exact id wins over a prefix-stripped match", () => {
    const ids = new Set(["00-atoms/badge", "atoms/badge"]);
    expect(resolveScssToComponent(at("00-atoms/_badge.scss"), styles, ids)).toBe("00-atoms/badge");
    expect(resolveScssToComponent(at("atoms/_badge.scss"), styles, ids)).toBe("atoms/badge");
  });

  it("an ambiguous prefix-stripped match attributes to no component", () => {
    const ids = new Set(["00-atoms/badge", "01-atoms/badge"]);
    expect(resolveScssToComponent(at("atoms/_badge.scss"), styles, ids)).toBeNull();
  });

  it("a file matching no component stays unattributed", () => {
    const ids = new Set(["00-atoms/badge"]);
    expect(resolveScssToComponent(at("00-base/_reset.scss"), styles, ids)).toBeNull();
    expect(resolveScssToComponent(at("styles.scss"), styles, ids)).toBeNull();
  });
});
