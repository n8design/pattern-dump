// B7 slice 2 — the param-list-aware include rewriter, in isolation (pure, no I/O).
//
// The load-bearing hazard edge (D1 §7): threading the lifted `modifier` at an include site must
// PRESERVE existing params and ADD the modifier — never overwrite. A rewrite that dropped a
// pre-existing param (`quick-link=this`) while adding `modifier` renders broken and can pass a naive
// test. Every case here carries a pre-existing param specifically to prove add-never-overwrite.

import { describe, it, expect } from "vitest";
import { rewriteIncludes, buildRewriteMap, type SiteRewrite, type CollapsedFamily } from "../src/index.js";

const map = new Map<string, SiteRewrite>([
  ["molecules-ql-list-button-outline", { baseHandle: "molecules-ql-list-button", modifier: " filled" }],
  ["molecules-radio-button-group",     { baseHandle: "molecules-radio-button",   modifier: "" }],
]);

describe("rewriteIncludes — param-list-aware, add-never-overwrite", () => {
  it("preserves a pre-existing param AND adds the modifier", () => {
    const { hbs, rewrites } = rewriteIncludes(`  {{> molecules-ql-list-button-outline quick-link=this }}\n`, map);
    expect(rewrites).toBe(1);
    expect(hbs).toContain("molecules-ql-list-button");     // handle swapped to the base
    expect(hbs).toContain("quick-link=this");              // pre-existing param SURVIVES
    expect(hbs).toContain('modifier=" filled"');           // modifier ADDED, faithful value
    expect(hbs).not.toContain("ql-list-button-outline");   // old flat handle gone
  });

  it("threads a bare include (no pre-existing param), modifier empty for the base-default", () => {
    const { hbs, rewrites } = rewriteIncludes(`{{> molecules-radio-button-group}}`, map);
    expect(rewrites).toBe(1);
    expect(hbs).toBe(`{{> molecules-radio-button modifier=""}}`);
  });

  it("rewrites EVERY occurrence in a file (not just the first)", () => {
    const src = `{{> molecules-radio-button-group}}\n<hr>\n{{> molecules-radio-button-group}}`;
    const { rewrites } = rewriteIncludes(src, map);
    expect(rewrites).toBe(2);
  });

  it("leaves includes of NON-mapped partials untouched", () => {
    const src = `{{> atoms-icon iconname="close" }}\n{{> molecules-ql-list-button-outline quick-link=this }}`;
    const { hbs, rewrites } = rewriteIncludes(src, map);
    expect(rewrites).toBe(1);
    expect(hbs).toContain(`{{> atoms-icon iconname="close" }}`); // untouched verbatim
  });

  it("rewrites a block partial's OPEN and its matching CLOSE tag", () => {
    const src = `{{#> molecules-radio-button-group data=x }}body{{/molecules-radio-button-group}}`;
    const { hbs, rewrites } = rewriteIncludes(src, map);
    expect(rewrites).toBe(1);
    expect(hbs).toContain(`{{#> molecules-radio-button data=x modifier=""}}`);
    expect(hbs).toContain(`{{/molecules-radio-button}}`);       // close renamed too
    expect(hbs).not.toContain("radio-button-group");            // no dangling old name
  });

  it("buildRewriteMap re-keys collapseFamily output onto handles (sourceId → oldHandle)", () => {
    const fam: CollapsedFamily = {
      baseId: "molecules/forms/radio-button",
      root: "hoo-radiobutton-group",
      baseHbs: "",
      variants: [
        { token: "group",            sourceId: "molecules/forms/radio-button-group",            modifier: "" },
        { token: "group-horizontal", sourceId: "molecules/forms/radio-button-group-horizontal", modifier: " is-horizontal" },
      ],
    };
    const built = buildRewriteMap([fam]);
    expect(built.get("molecules-radio-button-group")).toEqual({ baseHandle: "molecules-radio-button", modifier: "" });
    expect(built.get("molecules-radio-button-group-horizontal")).toEqual({ baseHandle: "molecules-radio-button", modifier: " is-horizontal" });
  });
});
