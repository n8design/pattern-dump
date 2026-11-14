// A data field a helper shadows (helper-shadow.ts): the demo's colour specimen, `{{id}}` inside `{{#each palettes}}`
// with an `id` in each palette, is a HELPER_SHADOW warning at the template's line; a field read by its path is not.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer, helperShadows } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const render = createRenderer({ patternsDir: join(here, "fixtures") });

describe("HELPER_SHADOW", () => {
  it("warns at the template's line when a bare {{id}} calls the helper and the data has an id", async () => {
    const out = await render({ component: "atoms/palette-list" });
    expect(out.meta?.diagnostics?.filter(d => d.kind === "HELPER_SHADOW")).toEqual([{
      kind: "HELPER_SHADOW", severity: "warning", source: "render",
      message: `{{id}} calls the helper "id", so the data's "palettes[].id" is never read here: write {{this.id}} to read the field, or give the field another name`,
      location: { file: expect.stringMatching(/atoms\/palette-list\/palette-list\.hbs$/), line: 2, column: 14 },
    }]);
  });

  it("leaves a field read by its path alone: this., ../ and @root.", async () => {
    const out = await render({ component: "atoms/palette-paths" });
    expect(out.meta?.diagnostics?.filter(d => d.kind === "HELPER_SHADOW") ?? []).toEqual([]);
  });

  it("leaves a helper called with arguments, a name the data doesn't have, and a name no helper has", () => {
    const helpers = ["id", "eq"];
    expect(helperShadows(`{{id "x"}}{{id prefix="y"}}`, { id: 1 }, helpers)).toEqual([]);
    expect(helperShadows(`{{eq}}`, { id: 1 }, helpers)).toEqual([]);
    expect(helperShadows(`{{label}}`, { label: "x" }, helpers)).toEqual([]);
    expect(helperShadows(`{{id}}`, { id: 1 }, helpers, new Set(["id"]))).toEqual([]);
    expect(helperShadows(`{{eq}}`, { rows: [{ eq: 1 }] }, helpers)).toEqual([{ name: "eq", at: "rows[].eq", line: 1, column: 1 }]);
  });
});
