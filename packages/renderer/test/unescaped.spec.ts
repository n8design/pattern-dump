// unescapedOutputs: what a template outputs without escaping ({{{x}}}, {{& x}}), with positions; escaped
// outputs, block statements and partials are not listed.
import { describe, expect, it } from "vitest";
import { unescapedOutputs } from "../src/index.js";

describe("unescapedOutputs", () => {
  it("lists triple-stash and & outputs, with their name and position, helpers named as calls", () => {
    const t = `<figure>\n  {{{caption}}}\n  <p>{{alt}}</p>\n  {{& credit}}\n  {{#each items}}{{{this.note}}}{{/each}}\n  {{{markdown body}}}\n  {{> atoms-slide}}\n</figure>\n`;
    expect(unescapedOutputs(t)).toEqual([
      { name: "caption", line: 2, column: 3, helper: false },
      { name: "credit", line: 4, column: 3, helper: false },
      { name: "note", line: 5, column: 18, helper: false },
      { name: "markdown …", line: 6, column: 3, helper: true },
    ]);
  });

  it("lists nothing for a template that escapes everything, or does not parse", () => {
    expect(unescapedOutputs(`<p>{{a}} {{#if b}}{{c}}{{/if}}</p>`)).toEqual([]);
    expect(unescapedOutputs(`<p>{{#if}}</p>`)).toEqual([]);
  });
});
