// A schema file that does not parse is a SCHEMA_INVALID error at its file, line and column, saying the component isn't
// checked against it until it's fixed. Never silently "no schema": that turned every schema check of the component
// off with no word. The component still renders.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index.js";
import { save } from "../../../test-support/save.js";

let root = "";
const write = async (rel: string, text: string) => { await mkdir(dirname(join(root, rel)), { recursive: true }); await save(join(root, rel), text); };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-schema-invalid-"));
  await write("atoms/broken/broken.hbs", `<p class="broken">{{label}}</p>\n`);
  await write("atoms/broken/broken.json", `{ "label": "Hi" }\n`);
  // A missing comma after "type": "string" (line 4).
  await write("atoms/broken/broken.schema.json", `{\n  "type": "object",\n  "properties": {\n    "label": { "type": "string" }\n    "size": { "type": "number" }\n  }\n}\n`);
  await write("atoms/fine/fine.hbs", `<p>{{label}}</p>\n`);
  await write("atoms/fine/fine.json", `{ "label": 1 }\n`);
  await write("atoms/fine/fine.schema.json", `{ "type": "object", "properties": { "label": { "type": "string" } } }\n`);
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const schemaDiagnostics = (meta: { diagnostics?: unknown[] } | undefined) =>
  ((meta?.diagnostics ?? []) as { kind: string; severity: string; message: string; location?: { file?: string; line?: number; column?: number } }[])
    .filter(d => d.kind === "SCHEMA_INVALID");

describe("a schema that is not valid JSON", () => {
  it("is an error at its file, line and column, and says the component isn't checked against it", async () => {
    const render = createRenderer({ patternsDir: root });
    const out = await render({ component: "atoms/broken" });
    expect(out.html).toContain(`<p class="broken">Hi</p>`);
    const found = schemaDiagnostics(out.meta);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", location: { file: "atoms/broken/broken.schema.json", line: 5, column: 5 } });
    expect(found[0]!.message).toMatch(/^broken\.schema\.json is not valid JSON \(.+\), so atoms\/broken isn't checked against its schema until it's fixed$/);
  });

  it("a schema that parses is checked as before (control)", async () => {
    const render = createRenderer({ patternsDir: root });
    const out = await render({ component: "atoms/fine" });
    expect(schemaDiagnostics(out.meta)).toEqual([]);
    expect((out.meta?.diagnostics ?? []).map(d => d.kind)).toContain("SHAPE_MISMATCH");
  });
});
