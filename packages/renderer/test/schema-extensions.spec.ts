// The placement schema extensions, checked (schema-extensions.ts): each rule once, a valid schema, the
// template rule (only for a schema that uses them), and render() reporting a broken schema as
// SCHEMA_INVALID, so it shows on its component before any page places it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { checkSchemaExtensions, createRenderer, readExampleHeight } from "../src/index";
import { save } from "../../../test-support/save.js";

const ctx = {
  componentExists: (id: string) => ["atoms/slide", "atoms/plain"].includes(id),
  hasSchema: (id: string) => id === "atoms/slide",
};
const check = (schema: unknown, template?: string) => checkSchemaExtensions(schema, template, ctx).map(p => `${p.path}: ${p.message}`);

describe("the placement schema extensions", () => {
  it("pass a schema that uses them as declared", () => {
    expect(check({
      "x-pd-content": "caption",
      properties: {
        caption: { type: "string", contentMediaType: "text/markdown" },
        slides: { type: "array", items: { "x-pd-component": "atoms/slide" } },
        meta: { type: "object", properties: { note: { type: "string", contentMediaType: "text/markdown" } } },
        "x-other": { type: "string" }, // other x- keys are left alone
      },
      "x-vendor": true,
    }, `<p>{{{caption}}}</p><p>{{{note}}}</p><p>{{slides}}</p>`)).toEqual([]);
  });

  it("x-pd-component: names a component that exists and has a schema", () => {
    expect(check({ properties: {
      a: { "x-pd-component": "atoms/nope" },
      b: { type: "array", items: { "x-pd-component": "atoms/plain" } },
      c: { "x-pd-component": 3 },
    } })).toEqual([
      `#/properties/a/x-pd-component: x-pd-component names "atoms/nope", which is not a component`,
      `#/properties/b/items/x-pd-component: x-pd-component names "atoms/plain", which has no schema, so it cannot be placed with values`,
      `#/properties/c/x-pd-component: x-pd-component must name a component`,
    ]);
  });

  it("x-pd-content: names a declared string property", () => {
    expect(check({ "x-pd-content": "body", properties: { text: { type: "string" } } }))
      .toEqual([`#/x-pd-content: x-pd-content names "body", which is not a declared property`]);
    expect(check({ "x-pd-content": "count", properties: { count: { type: "integer" } } }))
      .toEqual([`#/x-pd-content: x-pd-content names "count", which is not a string`]);
  });

  it("contentMediaType: only text/markdown, only on a string", () => {
    expect(check({ properties: { a: { type: "string", contentMediaType: "text/html" }, b: { type: "integer", contentMediaType: "text/markdown" } } })).toEqual([
      `#/properties/a/contentMediaType: contentMediaType must be "text/markdown" (got "text/html")`,
      `#/properties/b/contentMediaType: contentMediaType is only for a string property`,
    ]);
  });

  it("an unknown x-pd- key is an error, at the top and in a property", () => {
    expect(check({ "x-pd-contnet": "caption", properties: { caption: { type: "string", "x-pd-componnet": "atoms/slide" } } })).toEqual([
      `#/x-pd-contnet: "x-pd-contnet" is not a schema extension Pattern Dump knows (x-pd-component, x-pd-content, x-pd-example-height)`,
      `#/properties/caption/x-pd-componnet: "x-pd-componnet" is not a schema extension Pattern Dump knows (x-pd-component, x-pd-content, x-pd-example-height)`,
    ]);
  });

  it("x-pd-example-height: a whole number of pixels above 0, at a schema's top", () => {
    expect(check({ "x-pd-example-height": 112, properties: { text: { type: "string" } } })).toEqual([]);
    expect(readExampleHeight({ "x-pd-example-height": 112 })).toEqual({ height: 112 });
    expect(readExampleHeight({ properties: {} })).toEqual({});
    const wording = (got: string) => `#/x-pd-example-height: x-pd-example-height must be a whole number of pixels above 0 (got ${got}): `
      + `the live example's height at the widest column, no taller than its shortest variant`;
    for (const [value, got] of [[0, "0"], [-4, "-4"], [112.5, "112.5"], ["112", `"112"`], [null, "null"]] as const) {
      expect(check({ "x-pd-example-height": value })).toEqual([wording(got)]);
      expect(readExampleHeight({ "x-pd-example-height": value }).problem).toBe(wording(got).slice("#/x-pd-example-height: ".length));
    }
    // In a property it is not a known key.
    expect(check({ properties: { a: { type: "string", "x-pd-example-height": 10 } } })).toEqual([
      `#/properties/a/x-pd-example-height: "x-pd-example-height" is not a schema extension Pattern Dump knows (x-pd-component, x-pd-content, x-pd-example-height)`,
    ]);
  });

  it("x-pd-example-height doesn't make a component placeable: its template is not checked", () => {
    expect(check({ "x-pd-example-height": 80, properties: { body: { type: "string" } } }, `<main>{{{body}}}</main>`)).toEqual([]);
  });

  it("the template of a schema that uses them outputs unescaped only its text/markdown properties", () => {
    const schema = { "x-pd-content": "caption", properties: { caption: { type: "string", contentMediaType: "text/markdown" }, credit: { type: "string" } } };
    expect(check(schema, `<p>{{{caption}}}</p>\n<small>{{{credit}}}</small>{{{shout credit}}}`)).toEqual([
      `#: the template outputs "credit" ({{{credit}}}) unescaped at 2:8, which only a text/markdown property may be`,
      `#: the template outputs a helper's result ({{{shout …}}}) unescaped at 2:28, which only a text/markdown property may be`,
    ]);
    // A schema without placement extensions is not placeable: its template's {{{body}}} is its own affair.
    expect(check({ properties: { body: { type: "string" } } }, `<main>{{{body}}}</main>`)).toEqual([]);
  });
});

describe("render()", () => {
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pd-schema-ext-"));
    for (const [rel, text] of Object.entries({
      "atoms/bad/bad.hbs": `<p>{{{text}}}</p>\n`,
      "atoms/bad/bad.schema.json": JSON.stringify({ "x-pd-content": "text", properties: { text: { type: "string" } } }),
    })) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await save(join(root, rel), text);
    }
  });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("reports a component's broken schema as SCHEMA_INVALID, naming the schema file", async () => {
    const { discoveryMap, handleMap } = await buildDiscoveryMap(root);
    const render = createRenderer({ patternsDir: root, discoveryMap, handleMap });
    const r = await render({ component: "atoms/bad" });
    expect(r.meta?.diagnostics?.filter(d => d.kind === "SCHEMA_INVALID")).toEqual([{
      kind: "SCHEMA_INVALID", severity: "error", source: "schema", path: "#",
      message: `the template outputs "text" ({{{text}}}) unescaped at 1:4, which only a text/markdown property may be`,
      location: { file: "atoms/bad/bad.schema.json" },
    }]);
  });
});
