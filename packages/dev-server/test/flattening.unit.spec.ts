import { describe, it, expect } from "vitest";
import {
  deriveSkeleton,
  defaultMetric,
  detectFlattening,
  renderFlatteningReport,
  type FlatteningInput,
} from "../src/flattening.js";

// A flattened family: one skeleton, one class root, differing only by a class-token suffix.
const copy = (mod: string) =>
  `<a class="hoo-qlbtn hoo-qlbtn--${mod}" href="{{url}}"><span class="hoo-qlbtn__icon"></span><span class="hoo-qlbtn__label">{{label}}</span></a>`;

describe("deriveSkeleton", () => {
  it("strips class/attr VALUES and text, keeps attr NAMES", () => {
    const s = deriveSkeleton(`<a class="hoo-qlbtn x y" href="{{url}}">{{label}}</a>`);
    // one top-level <a> with attrs [class, href] (names, sorted), no text nodes
    expect(s.tree).toHaveLength(1);
    expect(s.tree[0].tag).toBe("a");
    expect(s.tree[0].attrs).toEqual(["class", "href"]);
    expect(s.tree[0].children).toHaveLength(0);
  });

  it("collapses token-drift copies to the SAME preorder (values are stripped)", () => {
    const a = deriveSkeleton(copy("fill"));
    const b = deriveSkeleton(copy("outline"));
    expect(a.preorder).toEqual(b.preorder);
  });

  it("extracts the static class root and all static classes; a dynamic suffix collapses to its base", () => {
    const s = deriveSkeleton(`<a class="hoo-qlbtn hoo-qlbtn--{{variant}}"><i class="ico"></i></a>`);
    expect(s.root).toBe("hoo-qlbtn");
    // `hoo-qlbtn--{{variant}}` → strip {{variant}} → `hoo-qlbtn--` → trim connector → `hoo-qlbtn`
    expect(s.staticClasses.sort()).toEqual(["hoo-qlbtn", "ico"]);
  });

  it("recovers a static token GLUED to a conditional (the delta-fix — hTWOo's style)", () => {
    // `class="hoo-qlbtn center{{#if mode}} mode-edit{{/if}}"` — `center` was previously lost because
    // it split as `center{{#if`. Stripping {{…}} first recovers it, so drift surfaces in deltas.
    const s = deriveSkeleton(`<article class="hoo-qlbtn center{{#if mode}} mode-edit{{/if}}"></article>`);
    expect(s.staticClasses).toContain("center");
    expect(s.staticClasses).toContain("hoo-qlbtn");
  });

  it("root is null when the outermost element carries no static class", () => {
    expect(deriveSkeleton(`<a href="{{url}}">{{label}}</a>`).root).toBeNull();
  });

  it("ignores Handlebars comments — commented-out markup is not structure or classes", () => {
    const s = deriveSkeleton(`<div class="box">{{!-- <li class="ghost"></li> --}}<span class="real"></span></div>`);
    expect(s.staticClasses.sort()).toEqual(["box", "real"]); // no "ghost" from the comment
    expect(s.tree[0].children).toHaveLength(1);               // only <span>, not the commented <li>
  });
});

describe("defaultMetric", () => {
  const m = defaultMetric();
  it("identical skeletons → confirm 1.0", () => {
    const a = deriveSkeleton(copy("fill"));
    const b = deriveSkeleton(copy("center"));
    expect(m.confirm(a, b)).toBe(1);
  });
  it("different structure → confirm < 1", () => {
    const a = deriveSkeleton(copy("fill"));
    const b = deriveSkeleton(`<button class="hoo-qlbtn"><span></span></button>`);
    expect(m.confirm(a, b)).toBeLessThan(1);
  });
});

describe("detectFlattening — the discriminator triple", () => {
  it("clusters N clean copies sharing a root + skeleton (triple #1 + #2, no edges)", () => {
    const inputs: FlatteningInput[] = [
      { id: "molecules/ql-fill", hbs: copy("fill") },
      { id: "molecules/ql-outline", hbs: copy("outline") },
      { id: "molecules/ql-center", hbs: copy("center") },
    ];
    const clusters = detectFlattening(inputs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toEqual([
      "molecules/ql-center",
      "molecules/ql-fill",
      "molecules/ql-outline",
    ]);
    expect(clusters[0].root).toBe("hoo-qlbtn");
  });

  it("STILL clusters a drifted copy (misspelled token) — similarity, not identity", () => {
    // The `oneline` vs `one-line` bug: same skeleton, a different class VALUE → same preorder,
    // so it clusters; the drift shows up in the deltas, not by excluding the file.
    const inputs: FlatteningInput[] = [
      { id: "molecules/ql-a", hbs: copy("oneline") },
      { id: "molecules/ql-b", hbs: copy("oneline") },
      { id: "molecules/ql-drift", hbs: copy("one-line") },
    ];
    const clusters = detectFlattening(inputs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toContain("molecules/ql-drift");
    // the delta surfaces the drift: the drift member has the odd token, misses the modal one
    const drift = clusters[0].deltas.find((d) => d.id === "molecules/ql-drift");
    expect(drift).toBeDefined();
    expect(drift!.extraClasses).toContain("hoo-qlbtn--one-line");
    expect(drift!.missingClasses).toContain("hoo-qlbtn--oneline");
  });

  it("does NOT cluster a legitimate sibling with a different skeleton (fails #2)", () => {
    const inputs: FlatteningInput[] = [
      { id: "molecules/ql-a", hbs: copy("fill") },
      { id: "molecules/ql-b", hbs: copy("outline") },
      // shared root, but a genuinely different shape (the button vs button-split case)
      {
        id: "molecules/ql-split",
        hbs: `<div class="hoo-qlbtn hoo-qlbtn--split"><a class="hoo-qlbtn__main">{{label}}</a><button class="hoo-qlbtn__toggle"><span></span></button></div>`,
      },
    ];
    const clusters = detectFlattening(inputs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).not.toContain("molecules/ql-split");
  });

  it("does NOT cluster a wrapper-includes-base pair (fails #3, composition-edge exclusion)", () => {
    // wrapper and base share root + near-identical skeleton, but the wrapper composes the base.
    const inputs: FlatteningInput[] = [
      { id: "molecules/ql-base", hbs: copy("fill") },
      { id: "molecules/ql-wrap", hbs: copy("outline") },
    ];
    const hasEdge = (a: string, b: string) =>
      (a === "molecules/ql-wrap" && b === "molecules/ql-base") ||
      (a === "molecules/ql-base" && b === "molecules/ql-wrap");
    const clusters = detectFlattening(inputs, { hasEdge });
    expect(clusters).toHaveLength(0); // the only pair is excluded by the edge
  });

  it("respects minClusterSize and excludes root-less components", () => {
    const inputs: FlatteningInput[] = [
      { id: "a", hbs: copy("fill") }, // lone copy → below default minClusterSize 2
      { id: "b", hbs: `<a href="{{u}}">{{l}}</a>` }, // no static root → excluded entirely
    ];
    expect(detectFlattening(inputs)).toHaveLength(0);
  });
});

describe("renderFlatteningReport", () => {
  it("writes a clean empty state when there are no clusters", () => {
    const md = renderFlatteningReport([]);
    expect(md).toContain("No flattened template clusters detected.");
    expect(md).toContain("SUBJECT-DEBT");
  });

  it("renders root, members, skeleton and the drift deltas, tagged SUBJECT-DEBT", () => {
    const clusters = detectFlattening([
      { id: "molecules/ql-a", hbs: copy("oneline") },
      { id: "molecules/ql-b", hbs: copy("oneline") },
      { id: "molecules/ql-drift", hbs: copy("one-line") },
    ]);
    const md = renderFlatteningReport(clusters, { subjectSha: "abc123" });
    expect(md).toContain("`hoo-qlbtn`");
    expect(md).toContain("`molecules/ql-drift`");
    expect(md).toContain("[SUBJECT-DEBT]");
    expect(md).toContain("hoo-qlbtn--one-line"); // the drift is in the delta list
    expect(md).toContain("abc123");
  });
});
