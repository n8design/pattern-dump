// The placed-component mode of the declared-values checker (checkPlaced): every level of a placed value is
// checked against what it declares, every problem is reported with its path and position, a value that is
// a component is checked against that component's schema, declared keys left unset are null at every
// level, and the boolean rule. The two existing modes are unchanged. Pure: the trees are built by hand.
import { describe, expect, it } from "vitest";
import {
  checkDeclared, checkPlaced, type ObjectSchema, type Placed, type PlacedContext, type PlacedEntry, type Pos,
} from "../src/storefront/declared-values.js";

const SCHEMAS: Record<string, ObjectSchema> = {
  "molecules/slider": {
    required: ["label", "slides"],
    properties: {
      label: { type: "string" }, perView: { type: "integer", enum: [1, 2, 3] }, loop: { type: "boolean" },
      slides: { type: "array", items: { "x-pd-component": "atoms/slide" } },
      meta: { type: "object", required: ["owner"], properties: { owner: { type: "string" }, note: { type: "string" } } },
    },
  },
  "atoms/slide": {
    required: ["image", "alt"], "x-pd-content": "caption",
    properties: { image: { type: "string" }, alt: { type: "string" }, caption: { type: "string", contentMediaType: "text/markdown" }, credit: { type: "string" } },
  },
  "atoms/bare": {},
};
const kebab = (k: string) => k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const ctx: PlacedContext = {
  schemaOf: async id => SCHEMAS[id],
  label: kebab,
  markdown: t => `<md>${t}</md>`,
};

let col = 0;
const at = (line = 1): Pos => ({ line, column: ++col });
const text = (value: string, line = 1): Placed => ({ kind: "text", value, at: at(line) });
const bare = (line = 1): Placed => ({ kind: "bare", at: at(line) });
const list = (items: Placed[], line = 1): Placed => ({ kind: "list", items, at: at(line) });
const entry = (key: string, value: Placed, label = kebab(key)): PlacedEntry => ({ key, label, at: value.at, value });
const keys = (entries: PlacedEntry[], line = 1): Placed & { kind: "keys" } => ({ kind: "keys", entries, at: at(line) });
const slide = (extra: PlacedEntry[] = [], line = 2) =>
  keys([entry("image", text("a.jpg", line), "image"), entry("alt", text("A", line), "alt"), ...extra], line);
const slider = (extra: PlacedEntry[] = [], slides = [slide()]) =>
  keys([entry("label", text("Talks")), entry("slides", list(slides, 2), "<pd-atoms-slide>"), ...extra]);

describe("checkPlaced", () => {
  it("checks every level, coerces the text, renders text/markdown, and fills unset declared keys with null at every level", async () => {
    const r = await checkPlaced("molecules/slider", slider(
      [entry("perView", text("2")), entry("loop", bare()), entry("meta", keys([entry("owner", text("Stefan"))]))],
      [slide([entry("caption", text("A **b**"), "content of <pd-atoms-slide>")])],
    ), "<pd-molecules-slider>", ctx);
    expect(r.problems).toEqual([]);
    expect(r.value).toEqual({
      label: "Talks", perView: 2, loop: true,
      slides: [{ image: "a.jpg", alt: "A", caption: "<md>A **b**</md>", credit: null }],
      meta: { owner: "Stefan", note: null },
    });
  });

  it("reports every problem, each with its path and position, not only the first", async () => {
    const r = await checkPlaced("molecules/slider", keys([
      entry("lable", text("Talks", 1)),
      entry("perView", text("two", 1)),
      entry("slides", list([
        keys([entry("image", text("a.jpg", 3), "image"), entry("captoin", text("x", 3), "captoin")], 3),
        keys([entry("image", text("b.jpg", 4), "image"), entry("alt", text("B", 4), "alt")], 4),
      ], 2), "<pd-atoms-slide>"),
      entry("meta", keys([entry("note", text("n", 5))], 5)),
    ], 1), "<pd-molecules-slider>", ctx);
    expect(r.problems.map(p => `${p.at.line}: ${p.message}`)).toEqual([
      `1: <pd-molecules-slider>: "lable" is not declared by molecules/slider — did you mean "label"?`,
      `1: <pd-molecules-slider>.per-view must be a whole number (got "two")`,
      `3: <pd-molecules-slider>.<pd-atoms-slide>[1]: "captoin" is not declared by atoms/slide — did you mean "caption"?`,
      `3: <pd-molecules-slider>.<pd-atoms-slide>[1]: "alt" is required by atoms/slide`,
      `5: <pd-molecules-slider>.meta: "owner" is required by <pd-molecules-slider>.meta`,
      `1: <pd-molecules-slider>: "label" is required by molecules/slider`,
    ]);
    // Positions are the ones the tree carries, column included.
    expect(r.problems.every(p => p.at.column > 0)).toBe(true);
  });

  it("checks a value that is a component against that component's schema", async () => {
    const wrong = keys([entry("label", text("inner", 3), "label")], 3);
    const r = await checkPlaced("molecules/slider", slider([], [wrong]), "<pd-molecules-slider>", ctx);
    expect(r.problems.map(p => p.message)).toEqual([
      `<pd-molecules-slider>.<pd-atoms-slide>[1]: "label" is not declared by atoms/slide`,
      `<pd-molecules-slider>.<pd-atoms-slide>[1]: "image" is required by atoms/slide`,
      `<pd-molecules-slider>.<pd-atoms-slide>[1]: "alt" is required by atoms/slide`,
    ]);
  });

  it("booleans: written bare is true, \"true\" and \"false\" are booleans, anything else is an error", async () => {
    const loop = async (v: Placed) => checkPlaced("molecules/slider", slider([entry("loop", v)]), "<pd-molecules-slider>", ctx);
    expect((await loop(bare())).value["loop"]).toBe(true);
    expect((await loop(text("true"))).value["loop"]).toBe(true);
    expect((await loop(text("false"))).value["loop"]).toBe(false);
    expect((await loop(text("yes"))).problems.map(p => p.message)).toEqual([`<pd-molecules-slider>.loop must be true or false (got "yes")`]);
    // Bare is only for a boolean.
    expect((await checkPlaced("molecules/slider", keys([entry("label", bare()), entry("slides", list([slide()]))]), "<pd-molecules-slider>", ctx)).problems
      .map(p => p.message)).toEqual([`<pd-molecules-slider>.label needs a value — only a boolean can be written without one`]);
  });

  it("refuses a component without a schema, and a value set twice", async () => {
    expect((await checkPlaced("atoms/none", keys([]), "<pd-atoms-none>", ctx)).problems.map(p => p.message))
      .toEqual([`<pd-atoms-none>: atoms/none has no schema, so it cannot be placed with values`]);
    expect((await checkPlaced("molecules/slider", slider([entry("label", text("again"))]), "<pd-molecules-slider>", ctx)).problems.map(p => p.message))
      .toEqual([`<pd-molecules-slider>: "label" is set twice`]);
  });
});

describe("the existing modes", () => {
  it("are unchanged: frontmatter mode still refuses an object, json mode checks nothing inside one", () => {
    const meta = SCHEMAS["molecules/slider"].properties!["meta"];
    expect(checkDeclared(meta, { note: "n" }, "frontmatter")).toEqual({ ok: false, message: "has a type (object) a page cannot set in frontmatter" });
    expect(checkDeclared(meta, { note: 3 }, "json")).toEqual({ ok: true, value: { note: 3 } });
    expect(checkDeclared({ type: "boolean" }, "yes", "frontmatter")).toEqual({ ok: false, message: `must be true or false (got "yes")` });
  });
});
