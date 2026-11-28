// The custom properties each stylesheet's rules read and declare (style-index.ts, in the compiled-rule walk), on
// test/fixtures/graph-properties: a stylesheet that holds two components' rules, a Sass variable and a mixin that
// write var(), a rule in context and rules with no class. Read from the compiled CSS, so a var() a mixin wrote counts
// for the rule that includes it, in the file that rule was written in.
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildAllStyleData } from "../src/style-index.js";

const root = fileURLToPath(new URL("./fixtures/graph-properties/", import.meta.url));
const styles = join(root, "src/styles");
const ids = new Set(["atoms/avatar", "atoms/badge", "molecules/facepile", "organisms/cards/doccard", "organisms/cards/tile"]);
const data = await buildAllStyleData(styles, ids, [join(styles, "main.scss")]);
const sheet = (rel: string) => {
  const found = data.stylesheets.get(join(styles, rel));
  expect(found, rel).toBeDefined();
  return found!;
};
const uses = (rel: string) => sheet(rel).properties.uses.map(u => [u.class, u.property, u.within.join(" ")].join(" | "));

describe("the custom properties of each compiled stylesheet", () => {
  it("a var() from a Sass variable and one from a mixin count for the rule that includes them, in its file", () => {
    expect(uses("organisms/_cards.scss")).toEqual(expect.arrayContaining([
      "pp-doccard | --pp-neutral-light | ",
      "pp-doccard | --pp-focus | ",
    ]));
    // Not in the files that wrote them: the variable's and the mixin's own files have no rules.
    expect(data.stylesheets.has(join(styles, "base/_colors.scss"))).toBe(false);
    expect(data.stylesheets.has(join(styles, "base/_mixins.scss"))).toBe(false);
  });

  it("a var() in another's fallback is a use too", () => {
    expect(uses("organisms/_cards.scss")).toEqual(expect.arrayContaining([
      "pp-doccard-link | --pp-link | ", "pp-doccard-link | --pp-neutral-light | ",
    ]));
  });

  it("a rule that styles a class inside another's is a use in context, keyed to the inner class", () => {
    expect(uses("organisms/_cards.scss")).toContain("pp-avatar | --pp-body-bg | pp-doccard");
    expect(uses("organisms/_cards.scss")).not.toContain("pp-doccard | --pp-body-bg | ");
  });

  it("a rule with no class reads and declares from its stylesheet", () => {
    expect(uses("base/_root.scss")).toEqual([" | --pp-gap | "]);
    expect([...sheet("base/_root.scss").properties.declares]).toEqual([["--pp-gap", { selector: ":root", context: "plain" }]]);
  });

  it("a stylesheet whose rules read no property has none", () => {
    expect(sheet("molecules/_facepile.scss").properties.uses).toEqual([]);
  });
});
