// The `pd-` tag parser (placed-tags.ts): which blocks it claims, the tag tree and its file positions, blank
// lines and indentation inside a tag, what it leaves alone, and how a tree becomes the checker's located
// values (attributes, children by `x-pd-component`, content by `x-pd-content`). No rendering here, except
// to show the rule is off unless a caller turns it on.
import { describe, expect, it } from "vitest";
import { readPlacedBlocks, toPlaced, type PlacedResolver } from "../src/placed-tags.js";
import { renderDoc } from "../src/markdown.js";
import type { ObjectSchema, Placed, PlacedProblem } from "../src/storefront/declared-values.js";

const SCHEMAS: Record<string, ObjectSchema> = {
  "molecules/slider": { properties: { label: { type: "string" }, slides: { type: "array", items: { "x-pd-component": "atoms/slide" } } } },
  "atoms/slide": { "x-pd-content": "caption", properties: { image: { type: "string" }, caption: { type: "string", contentMediaType: "text/markdown" } } },
  "atoms/note": { "x-pd-content": "text", properties: { text: { type: "string" } } },
};
const HANDLES: Record<string, string> = { "molecules-slider": "molecules/slider", "atoms-slide": "atoms/slide", "atoms-note": "atoms/note" };
const resolver: PlacedResolver = {
  idOf: h => HANDLES[h],
  handleOf: id => Object.entries(HANDLES).find(([, v]) => v === id)![0],
  handles: () => Object.keys(HANDLES),
  schemaOf: async id => SCHEMAS[id],
};
const FM = 4; // a page's frontmatter: ---, title, ---, blank line

/** The one claimed block's tree, as names and positions. */
function outline(body: string) {
  const blocks = readPlacedBlocks(body, FM);
  return blocks.map(b => ({
    problems: b.problems.map(p => `${p.at.line}:${p.at.column} ${p.message}`),
    root: b.root && (function walk(t): unknown {
      return { tag: `${t.name}@${t.at.line}:${t.at.column}`, attrs: t.attrs.map(a => `${a.name}=${a.value ?? "(bare)"}@${a.at.line}:${a.at.column}`), children: t.children.map(walk) };
    })(b.root),
  }));
}
async function placed(body: string) {
  const problems: PlacedProblem[] = [];
  const [block] = readPlacedBlocks(body, FM);
  const r = block?.root ? await toPlaced(block.root, resolver, problems) : {};
  return { ...r, problems: problems.map(p => `${p.at.line}:${p.at.column} ${p.message}`) };
}
const entry = (v: Placed | undefined, key: string) => v?.kind === "keys" ? v.entries.find(e => e.key === key)?.value : undefined;

describe("the pd- tag rule", () => {
  it("claims a block from its opening tag to its root's close, with file positions", () => {
    expect(outline(`<pd-molecules-slider label="Talks" loop>\n  <pd-atoms-slide image="a.jpg"></pd-atoms-slide>\n</pd-molecules-slider>\n`)).toEqual([{
      problems: [],
      root: {
        tag: "pd-molecules-slider@5:1", attrs: ["label=Talks@5:22", "loop=(bare)@5:36"],
        children: [{ tag: "pd-atoms-slide@6:3", attrs: ["image=a.jpg@6:19"], children: [] }],
      },
    }]);
  });

  it("works in a list item and in a blockquote, with columns in the file", () => {
    expect(outline(`- item\n\n  <pd-atoms-slide image="a.jpg">x</pd-atoms-slide>\n`)[0].root).toMatchObject({ tag: "pd-atoms-slide@7:3", attrs: ["image=a.jpg@7:19"] });
    expect(outline(`> <pd-atoms-slide image="a.jpg">\n> x\n> </pd-atoms-slide>\n`)[0].root).toMatchObject({ tag: "pd-atoms-slide@5:3", attrs: ["image=a.jpg@5:19"] });
  });

  it("keeps blank lines inside a tag in the tag: between children, and in content", async () => {
    const body = `<pd-molecules-slider label="x">\n\n  <pd-atoms-slide image="a.jpg">\n\n    First paragraph\n\n    - a list item\n\n  </pd-atoms-slide>\n\n  <pd-atoms-slide image="b.jpg"></pd-atoms-slide>\n\n</pd-molecules-slider>\n\nAfter.\n`;
    expect(readPlacedBlocks(body, FM)).toHaveLength(1);
    const r = await placed(body);
    expect(r.problems).toEqual([]);
    const slides = entry(r.values, "slides");
    expect(slides?.kind === "list" && slides.items.length).toBe(2);
    const first = slides?.kind === "list" ? slides.items[0] : undefined;
    // The content keeps its blank lines, dedented to the tag's indent: block markdown can read it.
    expect(entry(first, "caption")).toMatchObject({ kind: "text", value: "First paragraph\n\n- a list item", at: { line: 9, column: 5 } });
  });

  it("dedents content to its least indented line; children may be indented any amount", async () => {
    const r = await placed(`<pd-molecules-slider label="x">\n      <pd-atoms-slide image="a.jpg">\n        Line one\n          indented further\n        Line three\n      </pd-atoms-slide>\n</pd-molecules-slider>\n`);
    expect(r.problems).toEqual([]);
    const slides = entry(r.values, "slides");
    const first = slides?.kind === "list" ? slides.items[0] : undefined;
    expect(entry(first, "caption")).toMatchObject({ value: "Line one\n  indented further\nLine three" });
  });

  it("leaves alone: a tag indented four spaces (a code block), and one in the middle of a paragraph", () => {
    expect(readPlacedBlocks(`    <pd-atoms-slide image="a.jpg">x</pd-atoms-slide>\n`, FM)).toEqual([]);
    expect(readPlacedBlocks(`A sentence with <pd-atoms-slide image="a.jpg">x</pd-atoms-slide> in it.\n`, FM)).toEqual([]);
  });

  it("names what it cannot read: never closed, the wrong close, an unreadable attribute", () => {
    expect(outline(`<pd-molecules-slider label="x">\n  <pd-atoms-slide image="a.jpg"></pd-atoms-slide>\n\nText after.\n`)[0].problems)
      .toEqual([`5:1 <pd-molecules-slider> is never closed`]);
    expect(outline(`<pd-molecules-slider label="x">\n  <pd-atoms-slide image="a.jpg"></pd-molecules-slider>\n</pd-atoms-slide>\n`)[0].problems)
      .toEqual([`6:33 </pd-molecules-slider> closes <pd-atoms-slide> (opened at 6:3)`, `7:1 </pd-atoms-slide> closes <pd-molecules-slider> (opened at 5:1)`]);
    expect(outline(`<pd-atoms-slide image="a.jpg" =oops>x</pd-atoms-slide>\n`)[0].problems)
      .toEqual([`5:30 <pd-atoms-slide> has something it cannot read before its closing >`]);
  });
});

describe("a tag tree as located values", () => {
  it("maps attributes to camelCase keys, bare attributes to a marker, children to their property, content to x-pd-content", async () => {
    const r = await placed(`<pd-molecules-slider label="x">\n  <pd-atoms-slide image="a.jpg">ESPC **2025**</pd-atoms-slide>\n</pd-molecules-slider>\n`);
    expect(r).toMatchObject({ id: "molecules/slider", problems: [] });
    const slides = entry(r.values, "slides");
    const first = slides?.kind === "list" ? slides.items[0] : undefined;
    expect(entry(first, "caption")).toMatchObject({ kind: "text", value: "ESPC **2025**", at: { line: 6, column: 33 } });
    const bareLoop = await placed(`<pd-atoms-note data-x text-size="2" loop>hi</pd-atoms-note>\n`);
    expect(bareLoop.values?.entries.map(e => [e.key, e.label, e.value.kind])).toEqual([
      ["dataX", "data-x", "bare"], ["textSize", "text-size", "text"], ["loop", "loop", "bare"], ["text", "content of <pd-atoms-note>", "text"],
    ]);
  });

  it("names an unknown component, a child that does not belong, and content a tag does not take", async () => {
    expect((await placed(`<pd-molecules-slidr label="x"></pd-molecules-slidr>\n`)).problems)
      .toEqual([`5:1 <pd-molecules-slidr>: there is no component "molecules-slidr" — did you mean <pd-molecules-slider>?`]);
    expect((await placed(`<pd-molecules-slider label="x">\n  <pd-atoms-note>hi</pd-atoms-note>\n</pd-molecules-slider>\n`)).problems)
      .toEqual([`6:3 <pd-atoms-note> cannot be placed inside <pd-molecules-slider> — it takes <pd-atoms-slide>`]);
    expect((await placed(`<pd-molecules-slider label="x">stray words</pd-molecules-slider>\n`)).problems)
      .toEqual([`5:32 <pd-molecules-slider> takes no content text, found "stray words"`]);
  });
});

describe("with the rule off", () => {
  it("renderDoc escapes a pd- tag as it always has", async () => {
    const html = await renderDoc(`<pd-atoms-slide image="a.jpg">x</pd-atoms-slide>\n`, async () => "", new Map());
    expect(html).toBe(`<p>&lt;pd-atoms-slide image=&quot;a.jpg&quot;&gt;x&lt;/pd-atoms-slide&gt;</p>\n`);
  });
});
