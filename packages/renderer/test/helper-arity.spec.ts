// The comparison helpers and defaultValue with a missing argument (AUT-131, AUT-130): Handlebars hands a helper its
// options object last, so a call one argument short read that object as the argument, and rendered
// `[object Object]` or a silent false. A missing argument is now an error naming the helper; `and` and `or` take
// exactly two (AUT-034). The two-argument forms render as before.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderer } from "../src/index.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
const CASES: Record<string, string> = {
  "default-short": `{{defaultValue missing}}`,
  "eq-short": `{{#if (eq a)}}yes{{else}}no{{/if}}`,
  "and-long": `{{#if (and a b c)}}yes{{else}}no{{/if}}`,
  "or-long": `{{#if (or a b c)}}yes{{else}}no{{/if}}`,
  "not-short": `{{#if (not)}}yes{{else}}no{{/if}}`,
  "isdefined-short": `{{#if (isdefined)}}yes{{else}}no{{/if}}`,
  "lt-short": `{{#if (lt a)}}yes{{else}}no{{/if}}`,
  "two": `{{defaultValue missing "fallback"}} {{#if (eq a a)}}eq{{/if}} {{#if (and a b)}}and{{/if}} {{#if (or a missing)}}or{{/if}} {{#if (not missing)}}not{{/if}} {{#if (isdefined a)}}defined{{/if}} {{#if (lt 1 2)}}lt{{/if}}`,
};
let render: ReturnType<typeof createRenderer>;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-helper-arity-"));
  for (const [id, src] of Object.entries(CASES)) {
    await mkdir(join(tmp, "atoms", id), { recursive: true });
    await save(join(tmp, "atoms", id, `${id}.hbs`), src);
    await save(join(tmp, "atoms", id, `${id}.json`), JSON.stringify({ a: 1, b: 2, c: 3 }));
  }
  render = createRenderer({ patternsDir: tmp });
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("a helper called with too few or too many arguments", () => {
  for (const [id, message] of [
    ["default-short", "defaultValue needs 2 arguments, got 1"],
    ["eq-short", "eq needs 2 arguments, got 1"],
    ["lt-short", "lt needs 2 arguments, got 1"],
    ["not-short", "not needs 1 argument, got 0"],
    ["isdefined-short", "isdefined needs 1 argument, got 0"],
    ["and-long", "and takes exactly 2 arguments, got 3"],
    ["or-long", "or takes exactly 2 arguments, got 3"],
  ] as const) {
    it(`${id}: fails, naming the helper`, async () => {
      await expect(render({ component: `atoms/${id}` })).rejects.toThrow(message);
    });
  }

  it("the forms with the right arguments render as before", async () => {
    expect((await render({ component: "atoms/two" })).html.trim()).toBe("fallback eq and or not defined lt");
  });
});
