// Tags have been objects since 0.5.0 (key, label, description, route). A component that contradicts itself about
// them is reported in the workbench, naming the fix: its template reads a tag's fields while its sample data or its
// schema gives strings (it renders empty <li></li>), or it writes a tag whole while its schema declares objects (it
// renders "[object Object]"). A component whose tags are simply strings, read as strings, is left alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index.js";
import { save } from "../../../test-support/save.js";

let root = "";
const write = async (rel: string, text: string) => { await mkdir(dirname(join(root, rel)), { recursive: true }); await save(join(root, rel), text); };
const LIST = `<ul>\n{{#each tags}}\n  <li><a href="{{route}}">{{label}}</a></li>\n{{/each}}\n</ul>\n`;
const WHOLE = `<ul>\n{{#each tags}}\n  <li>{{this}}</li>\n{{/each}}\n</ul>\n`;
const objects = { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" } } } };
const strings = { type: "array", items: { type: "string" } };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-tags-as-strings-"));
  // Reads {{label}}, sample data gives strings: the demo's case.
  await write("molecules/data-strings/data-strings.hbs", LIST);
  await write("molecules/data-strings/data-strings.json", `{ "tags": ["design", "layout"] }\n`);
  // Reads {{label}}, schema declares strings (sample data as objects).
  await write("molecules/schema-strings/schema-strings.hbs", LIST);
  await write("molecules/schema-strings/schema-strings.json", `{ "tags": [{ "key": "design", "label": "Design" }] }\n`);
  await write("molecules/schema-strings/schema-strings.schema.json", JSON.stringify({ type: "object", properties: { tags: strings } }, null, 2));
  // Writes {{this}}, schema declares objects.
  await write("molecules/whole/whole.hbs", WHOLE);
  await write("molecules/whole/whole.json", `{ "tags": [{ "key": "design", "label": "Design" }] }\n`);
  await write("molecules/whole/whole.schema.json", JSON.stringify({ type: "object", properties: { tags: objects } }, null, 2));
  // Objects throughout, read by field: fine.
  await write("molecules/fine/fine.hbs", LIST);
  await write("molecules/fine/fine.json", `{ "tags": [{ "key": "design", "label": "Design", "route": "/tags/design/" }] }\n`);
  await write("molecules/fine/fine.schema.json", JSON.stringify({ type: "object", properties: { tags: objects } }, null, 2));
  // Strings throughout, written whole: a design system's own tags, nothing to do with a site.
  await write("molecules/plain/plain.hbs", WHOLE);
  await write("molecules/plain/plain.json", `{ "tags": ["a", "b"] }\n`);
  await write("molecules/plain/plain.schema.json", JSON.stringify({ type: "object", properties: { tags: strings } }, null, 2));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

type D = { kind: string; severity: string; message: string; location?: { file?: string; line?: number; column?: number } };
async function tagProblems(id: string): Promise<D[]> {
  const out = await createRenderer({ patternsDir: root })({ component: id });
  return ((out.meta?.diagnostics ?? []) as D[]).filter(d => d.message.includes("a tag is an object since 0.5.0"));
}

describe("tags given as strings", () => {
  it("sample data with strings, read as objects: an error at the template, naming tag objects as the fix", async () => {
    expect(await tagProblems("molecules/data-strings")).toEqual([{
      kind: "SHAPE_MISMATCH", severity: "error", source: "render",
      message: `{{#each tags}} reads {{route}}, but the tags in the sample data are strings: a tag is an object since 0.5.0 `
        + `(key, label, description, route): give each one as { "key": "design", "label": "Design" } in data-strings.json`,
      location: { file: "molecules/data-strings/data-strings.hbs", line: 3, column: 16 },
    }]);
  });

  it("a schema declaring strings, read as objects: an error at the schema", async () => {
    expect(await tagProblems("molecules/schema-strings")).toEqual([{
      kind: "SCHEMA_INVALID", severity: "error", source: "schema",
      message: `schema-strings.schema.json declares tags as a list of strings, but {{#each tags}} reads {{route}} (line 3): `
        + `a tag is an object since 0.5.0 (key, label, description, route): declare its items as "type": "object"`,
      path: "#/properties/tags", location: { file: "molecules/schema-strings/schema-strings.schema.json" },
    }]);
  });

  it("a tag written whole while the schema declares objects: an error naming {{label}}", async () => {
    expect(await tagProblems("molecules/whole")).toEqual([{
      kind: "SCHEMA_INVALID", severity: "error", source: "schema",
      message: `{{#each tags}} writes {{this}} (line 3), but whole.schema.json declares tags as objects: a tag is an object `
        + `since 0.5.0 (key, label, description, route): write {{label}} to show it ({{key}} is its URL segment, {{route}} its page)`,
      path: "#/properties/tags", location: { file: "molecules/whole/whole.hbs", line: 3, column: 7 },
    }]);
  });

  it("objects read by field, and strings written whole, are left alone (controls)", async () => {
    expect(await tagProblems("molecules/fine")).toEqual([]);
    expect(await tagProblems("molecules/plain")).toEqual([]);
  });
});
