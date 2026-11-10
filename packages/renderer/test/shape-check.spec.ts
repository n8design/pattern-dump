// render()'s shape check (SHAPE_MISMATCH, a warning): each top-level value the merged data holds for a
// declared property has the type the schema names. A list is JSON's array — not an object, though
// typeof [] is "object" — so an array field holding a list passes, and one holding anything else, or an
// object field holding a list, is a mismatch.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "../src/index";
import { save } from "../../../test-support/save.js";

const SCHEMA = JSON.stringify({
  properties: {
    rows: { type: "array", items: { type: "string" } },
    meta: { type: "object" },
    count: { type: "integer" },
    ratio: { type: "number" },
    title: { type: "string" },
    either: { type: ["array", "string"] },
  },
});

describe("render() — the shape check", () => {
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pd-shape-check-"));
    for (const [rel, text] of Object.entries({ "atoms/shape/shape.hbs": "<p>{{title}}</p>\n", "atoms/shape/shape.schema.json": SCHEMA })) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await save(join(root, rel), text);
    }
  });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  const mismatches = async (data: Record<string, unknown>) => {
    const { discoveryMap, handleMap } = await buildDiscoveryMap(root);
    const render = createRenderer({ patternsDir: root, discoveryMap, handleMap });
    return ((await render({ component: "atoms/shape", data })).meta?.diagnostics ?? [])
      .filter(d => d.kind === "SHAPE_MISMATCH").map(d => d.message);
  };

  it("passes a list in an array field", async () => {
    expect(await mismatches({ rows: ["a", "b"], meta: { a: 1 }, count: 2, ratio: 0.5, title: "T", either: ["x"] })).toEqual([]);
    expect(await mismatches({ rows: [], either: "x" })).toEqual([]);
  });

  it("reports anything else in an array field, and a list in an object field", async () => {
    expect(await mismatches({ rows: "a, b", meta: ["a"], either: { a: 1 } })).toEqual([
      `Field "rows" expected array but got string`,
      `Field "meta" expected object but got array`,
      `Field "either" expected array | string but got object`,
    ]);
  });

  it("keeps the scalar cases as they were", async () => {
    expect(await mismatches({ count: 2.5, ratio: 3, title: 7 })).toEqual([
      `Field "count" expected integer but got number`,
      `Field "title" expected string but got number`,
    ]);
  });
});
