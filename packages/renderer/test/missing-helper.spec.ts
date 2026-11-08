// A template that calls a helper nobody registered fails with the helper's name and the template that
// called it (a partial, when the call is in a partial), and where in it. A `{{name}}` with no arguments is
// not a helper call and renders nothing, as in stock Handlebars; a project may still replace the handling.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRenderer, MissingHelperError } from "../src/index.js";
import { save } from "../../../test-support/save.js";

let patterns = "";
async function write(rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(patterns, rel)), { recursive: true });
  await save(join(patterns, rel), text);
}

beforeAll(async () => {
  patterns = join(await mkdtemp(join(tmpdir(), "pd-missing-helper-")), "patterns");
  await write("atoms/chip/chip.hbs", `<span class="chip">\n  {{shout "x"}}\n</span>\n`);
  await write("molecules/card/card.hbs", `<div class="card">{{> atoms-chip }}</div>\n`);
  await write("atoms/plain/plain.hbs", `<p>[{{nothing}}]</p>\n`);
});
afterAll(async () => { if (patterns) await rm(join(patterns, ".."), { recursive: true, force: true }); });

const failure = async (r: ReturnType<typeof createRenderer>, component: string): Promise<MissingHelperError> => {
  try {
    await r({ component });
  } catch (e) {
    if (e instanceof MissingHelperError) return e;
    throw e;
  }
  throw new Error(`${component} rendered`);
};

describe("a missing helper", () => {
  it("names the helper and the template that calls it, with where", async () => {
    const e = await failure(createRenderer({ patternsDir: patterns }), "atoms/chip");
    expect(e.message).toBe(`Missing helper "shout", called by atoms/chip (line 2, column 3)`);
    expect(e.location).toEqual({ file: "atoms/chip/chip.hbs", line: 2, column: 3 });
  });

  it("names the partial that calls it, not the template that includes the partial", async () => {
    const e = await failure(createRenderer({ patternsDir: patterns }), "molecules/card");
    expect(e.message).toBe(`Missing helper "shout", called by atoms/chip (line 2, column 3)`);
    expect(e.template).toBe("atoms/chip");
  });

  it("names the file as the caller's displayPath names it", async () => {
    const e = await failure(createRenderer({ patternsDir: patterns, displayPath: p => `pkg/${p.slice(patterns.length + 1)}` }), "molecules/card");
    expect(e.location.file).toBe("pkg/atoms/chip/chip.hbs");
  });

  it("leaves a {{name}} with no arguments empty, as stock Handlebars does", async () => {
    expect((await createRenderer({ patternsDir: patterns })({ component: "atoms/plain" })).html).toContain("<p>[]</p>");
  });

  it("lets a project register its own helperMissing", async () => {
    const r = createRenderer({ patternsDir: patterns, helpers: { helperMissing: () => "(none)" } });
    expect((await r({ component: "atoms/chip" })).html).toContain("(none)");
  });
});
