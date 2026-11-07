// The preview document's layering, pinned as exact strings: the document-base layer, asset CSS, the
// theme layer, the component closure, SVG symbols, the measurement script and behaviour scripts, in
// the order buildPreviewDocument writes them. A change to how a preview document is put together has
// to show up here as a snapshot change; a refactor of the same code must leave every snapshot as it is.
//
// Run with CI=true, so a missing snapshot fails instead of being written, and treat an obsolete snapshot
// as a failure.
import { describe, it, expect } from "vitest";
import type { LayoutMode, ThemeSwitch } from "@pattern-dump/contracts";
import { buildPreviewDocument } from "../src/preview-document.js";

const HTML = `<button class="b">Go</button>`;
const CLOSURE = ["atoms/icon", "atoms/button"];
const THEMES = ["light", "dark"];

/** Everything in the document up to and including </head>. */
const headOf = (doc: string): string => doc.slice(0, doc.indexOf("</head>") + "</head>".length);

// ---- Head layers: the full cross product of what the head is built from ----
// layout "full" keeps the body short (no content-width script); the body has its own matrix below.
type HeadCase = {
  themeSwitch: ThemeSwitch; defaultTheme: string | undefined; linkBase: boolean;
  baseCssVersion: number; assetsCss: string[] | undefined; closure: string[];
};
const headCases: Array<[string, HeadCase]> = [];
for (const themeSwitch of ["attribute", "stylesheet"] as const)
  for (const defaultTheme of ["light", undefined])
    for (const linkBase of [false, true])
      for (const baseCssVersion of [0, 3])
        for (const assetsCss of [undefined, ["css/fonts.css", "https://fonts.example/f.css"]])
          for (const closure of [[], CLOSURE]) {
            const name = [`switch=${themeSwitch}`, `default=${defaultTheme ?? "-"}`, `base=${linkBase}`,
              `baseV=${baseCssVersion}`, `assets=${assetsCss ? "2" : "-"}`, `closure=${closure.length}`].join(" ");
            headCases.push([name, { themeSwitch, defaultTheme, linkBase, baseCssVersion, assetsCss, closure }]);
          }

describe("preview document head layering", () => {
  it("covers the whole matrix", () => {
    expect(headCases).toHaveLength(64);
  });

  for (const [name, c] of headCases) {
    it(name, () => {
      const doc = buildPreviewDocument(HTML, c.closure, "full", THEMES, c.defaultTheme, undefined, undefined,
        c.assetsCss, "atoms/button", undefined, undefined, c.linkBase, c.themeSwitch, c.baseCssVersion);
      expect(headOf(doc)).toMatchSnapshot();
    });
  }
});

// ---- Whole documents: layout, scripts (local with and without a version, and a URL), SVG symbols,
// <base>, and a component id ----
type BodyCase = { layout: LayoutMode; scripts: boolean; svg: boolean; baseHref: string | undefined };
const bodyCases: Array<[string, BodyCase]> = [];
for (const layout of ["centered", "full"] as const)
  for (const scripts of [false, true])
    for (const svg of [false, true])
      for (const baseHref of [undefined, "/pd/"])
        bodyCases.push([`layout=${layout} scripts=${scripts} svg=${svg} base=${baseHref ?? "-"}`, { layout, scripts, svg, baseHref }]);

describe("preview document, whole", () => {
  it("covers the whole matrix", () => {
    expect(bodyCases).toHaveLength(16);
  });

  for (const [name, c] of bodyCases) {
    it(name, () => {
      const scripts = c.scripts ? ["toggle", "nav", "https://cdn.example/x.js"] : undefined;
      const versions = c.scripts ? new Map([["toggle", 1767319445000]]) : undefined; // "nav": no version
      const svg = c.svg ? [`<svg hidden><symbol id="i-x"></symbol></svg>`] : undefined;
      const doc = buildPreviewDocument(HTML, CLOSURE, c.layout, THEMES, "light", scripts, svg, ["css/fonts.css"],
        "atoms/button", c.baseHref, versions, true, "attribute", 0);
      expect(doc).toMatchSnapshot();
    });
  }
});
