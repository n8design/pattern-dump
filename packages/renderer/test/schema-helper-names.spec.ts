// A schema field named like a registered helper (schema-helper-names.ts): `{{id}}` would call the helper,
// never read the field. Checked at any depth against every helper the render has, and reported by render()
// as SCHEMA_INVALID on the component.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { checkSchemaHelperNames, createRenderer, isHelperNameProblem } from "../src/index";
import { save } from "../../../test-support/save.js";

const said = (name: string) => `"${name}" is the name of a registered helper, so {{${name}}} would call the helper, not read this field`;
const check = (schema: unknown, helpers: string[]) => checkSchemaHelperNames(schema, helpers).map(p => `${p.path}: ${p.message}`);

describe("checkSchemaHelperNames", () => {
  it("finds a field at the top, inside an object, and inside a list's items", () => {
    expect(check({
      properties: {
        id: { type: "string" },
        meta: { type: "object", properties: { each: { type: "string" } } },
        rows: { type: "array", items: { type: "object", properties: { eq: { type: "boolean" }, label: { type: "string" } } } },
      },
    }, ["id", "each", "eq"])).toEqual([
      `#/properties/id: ${said("id")}`,
      `#/properties/meta/properties/each: ${said("each")}`,
      `#/properties/rows/items/properties/eq: ${said("eq")}`,
    ]);
  });

  it("passes fields no helper is named after, `anchor` among them", () => {
    expect(check({ properties: { anchor: { type: "string" }, title: { type: "string" } } }, ["id", "eq", "if"])).toEqual([]);
  });

  it("passes a schema with no properties, and what is not a schema", () => {
    expect(check({ type: "object" }, ["id"])).toEqual([]);
    expect(check(null, ["id"])).toEqual([]);
  });

  it("names its own problems, and no other message", () => {
    expect(isHelperNameProblem(said("id"))).toBe(true);
    expect(isHelperNameProblem(`"x-pd-thing" is not a schema extension Pattern Dump knows (x-pd-component, x-pd-content, x-pd-example-height)`)).toBe(false);
  });
});

describe("render() — every helper the render has", () => {
  let root = "";
  const schemaOf = (...names: string[]) => JSON.stringify({ properties: Object.fromEntries(names.map(n => [n, { type: "string" }])) });
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pd-helper-names-"));
    for (const [rel, text] of Object.entries({
      // Pattern Dump's own (id, eq), Handlebars' (lookup, with), a project helper (shout), a registrar's (stamp).
      "atoms/own/own.hbs": `<p>{{title}}</p>\n`, "atoms/own/own.schema.json": schemaOf("id", "eq", "title"),
      "atoms/stock/stock.hbs": `<p>{{title}}</p>\n`, "atoms/stock/stock.schema.json": schemaOf("lookup", "with", "title"),
      "atoms/project/project.hbs": `<p>{{title}}</p>\n`, "atoms/project/project.schema.json": schemaOf("shout", "stamp", "title"),
    })) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await save(join(root, rel), text);
    }
  });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  const problems = async (component: string) => {
    const { discoveryMap, handleMap } = await buildDiscoveryMap(root);
    const render = createRenderer({
      patternsDir: root, discoveryMap, handleMap,
      helpers: { shout: (s: unknown) => String(s).toUpperCase() },
      helperRegistrars: [(hb: unknown) => { (hb as { registerHelper(n: string, f: () => string): void }).registerHelper("stamp", () => "x"); }],
    });
    return (await render({ component, data: { title: "T" } })).meta?.diagnostics?.filter(d => d.kind === "SCHEMA_INVALID") ?? [];
  };

  it("reports Pattern Dump's helpers as SCHEMA_INVALID, naming the schema file", async () => {
    expect(await problems("atoms/own")).toEqual([
      { kind: "SCHEMA_INVALID", severity: "error", source: "schema", path: "#/properties/id", message: said("id"), location: { file: "atoms/own/own.schema.json" } },
      { kind: "SCHEMA_INVALID", severity: "error", source: "schema", path: "#/properties/eq", message: said("eq"), location: { file: "atoms/own/own.schema.json" } },
    ]);
  });

  it("reports Handlebars' built-ins", async () => {
    expect((await problems("atoms/stock")).map(d => d.message)).toEqual([said("lookup"), said("with")]);
  });

  it("reports the project's helpers, by option and by registrar", async () => {
    expect((await problems("atoms/project")).map(d => d.message)).toEqual([said("shout"), said("stamp")]);
  });
});
