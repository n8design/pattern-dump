// The base-layer report lists every file whose rules no component owns and no documentBase lists, so
// a design system can act on all of them rather than on the three the console line names.
import { describe, it, expect } from "vitest";
import { renderBaseLayerReport } from "../src/surfacing.js";

describe("renderBaseLayerReport", () => {
  it("lists every file with its rule count, most rules first, paths relative to the project", () => {
    const md = renderBaseLayerReport(new Map([
      ["/p/node_modules/core/sass/_nav.scss", 3],
      ["/p/node_modules/core/sass/01-atoms/input/_input.scss", 12],
      ["/p/src/styles/_a.scss", 3],
    ]), "/p");
    const rows = md.split("\n").filter(l => l.startsWith("| ") && !l.startsWith("| Rules"));
    expect(rows).toEqual([
      "| 12 | `node_modules/core/sass/01-atoms/input/_input.scss` |",
      "| 3 | `node_modules/core/sass/_nav.scss` |",
      "| 3 | `src/styles/_a.scss` |",
    ]);
    expect(md).toContain("18 rule(s) in 3 file(s).");
  });

  it("says none when every base rule is listed or owned", () => {
    expect(renderBaseLayerReport(new Map(), "/p")).toContain("None.");
  });
});
