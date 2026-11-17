// What a render's checks work out from a template's text alone is worked out once per text (template-memo.ts): after
// the first render, more renders of the component, by the same renderer or a new one (pd dev makes one per
// discovery), parse no template again. Counted as calls of Handlebars' parser.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Handlebars from "handlebars";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "../src/index";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-template-memo-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("a render's template checks", () => {
  it("parse each template once, however often it is rendered", async () => {
    const files: Record<string, string> = {
      "molecules/card/card.hbs": `<article><h2>{{title}}</h2><ul>{{#each tags}}<li>{{label}}</li>{{/each}}</ul>{{> atoms-chip}}</article>\n`,
      "molecules/card/card.json": `{ "title": "card", "tags": [{ "key": "a", "label": "A" }] }\n`,
      "molecules/card/card.schema.json": `{ "type": "object", "properties": { "title": { "type": "string" } } }\n`,
      "atoms/chip/chip.hbs": `<span>{{{label}}}</span>\n`,
    };
    for (const [rel, text] of Object.entries(files)) {
      await mkdir(dirname(join(tmp, rel)), { recursive: true });
      await save(join(tmp, rel), text);
    }
    const { discoveryMap, handleMap } = await buildDiscoveryMap(tmp);
    const renderer = () => createRenderer({ patternsDir: tmp, discoveryMap, handleMap });
    const parse = vi.spyOn(Handlebars, "parse");
    try {
      const first = renderer();
      expect((await first({ component: "molecules/card" })).html).toContain("<li>A</li>");
      const afterFirst = parse.mock.calls.length;
      expect(afterFirst).toBeGreaterThan(0);
      for (let i = 0; i < 3; i++) await first({ component: "molecules/card" });
      await renderer()({ component: "molecules/card" });
      expect(parse.mock.calls.length).toBe(afterFirst);
    } finally { parse.mockRestore(); }
  });
});
