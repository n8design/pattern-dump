// A data-overlay variant (`chip~danger.json` beside `chip.hbs`) takes its own `.md` and `.schema.json`, as an
// own-markup variant (`chip~icon.hbs`) always has. Discovery used to give it neither, so `chip~danger.md` was
// ignored and the variant showed the base's docs under the title `chip~danger`. Without a `.md` of its own a
// variant still shows the base's docs. A variant's `.schema.json` was also read as a data-overlay variant of its
// own (`chip~icon.schema`); it is a sidecar only. Fixtures are throwaway, as in layout-mode.spec.ts.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { buildComponentDetail } from "../src/detail.js";
import { save } from "../../../test-support/save.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function patterns(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pd-variant-sidecars-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  return root;
}

const noRender = async () => ({ html: "" });

const FILES = {
  "atoms/chip/chip.hbs": "<span>{{label}}</span>",
  "atoms/chip/chip.json": `{ "label": "Chip" }`,
  "atoms/chip/chip.md": "---\ntitle: Chip\n---\n\nThe base chip's docs.\n",
  "atoms/chip/chip~danger.json": `{ "label": "Danger" }`,
  "atoms/chip/chip~danger.md": "---\ntitle: Danger chip\ndescription: For destructive actions.\n---\n\nThe danger chip's own docs.\n",
  "atoms/chip/chip~danger.schema.json": `{ "type": "object", "properties": { "label": { "type": "string" } } }`,
  "atoms/chip/chip~quiet.json": `{ "label": "Quiet" }`,
  "atoms/chip/chip~icon.hbs": "<span aria-label=\"{{label}}\"></span>",
  "atoms/chip/chip~icon.schema.json": `{ "type": "object" }`,
};

describe("data-overlay variant sidecars", () => {
  it("discovery gives a data-overlay variant its own .md and .schema.json", async () => {
    const dir = await patterns(FILES);
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const danger = discoveryMap.get("atoms/chip~danger")!;
    expect(danger.mdPath).toBe(join(dir, "atoms/chip/chip~danger.md"));
    expect(danger.schemaPath).toBe(join(dir, "atoms/chip/chip~danger.schema.json"));
    expect(danger.hbsPath).toBe(join(dir, "atoms/chip/chip.hbs"));
    expect(discoveryMap.get("atoms/chip~icon")!.schemaPath).toBe(join(dir, "atoms/chip/chip~icon.schema.json"));
    // A variant's schema is a sidecar, never a data-overlay variant of its own.
    expect([...discoveryMap.keys()].filter(id => id.endsWith(".schema"))).toEqual([]);
    const quiet = discoveryMap.get("atoms/chip~quiet")!;
    expect(quiet.mdPath).toBeUndefined();
    expect(quiet.schemaPath).toBeUndefined();
  });

  it("the detail shows the variant's own title, description and docs", async () => {
    const dir = await patterns(FILES);
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const detail = await buildComponentDetail("atoms/chip~danger", dir, noRender, { css: "" }, undefined, new Map(), undefined, undefined, undefined, discoveryMap);
    expect(detail.title).toBe("Danger chip");
    expect(detail.description).toBe("For destructive actions.");
    expect(detail.doc).toContain("The danger chip's own docs.");
    expect(detail.doc).not.toContain("The base chip's docs.");
    expect(detail.source.schema).toContain(`"label"`);
  });

  it("a variant without a .md of its own still shows the base's docs", async () => {
    const dir = await patterns(FILES);
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const detail = await buildComponentDetail("atoms/chip~quiet", dir, noRender, { css: "" }, undefined, new Map(), undefined, undefined, undefined, discoveryMap);
    expect(detail.doc).toContain("The base chip's docs.");
  });
});
