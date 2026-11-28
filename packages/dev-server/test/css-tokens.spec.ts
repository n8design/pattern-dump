// The colour tokens of the document base layer, read from compiled CSS (css-tokens.ts): the values a symbol image's
// standalone file declares. Three shapes real projects compile to, and the cases that must fail instead of guessing.
// Then the custom properties each rule reads and declares, for the graph.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileSassFile } from "@pattern-dump/build";
import { baseTokens, propertyFacts, selectorAnchors, varNames } from "../src/css-tokens.js";

const entries = (css: string) => Object.fromEntries(baseTokens(css).tokens);

describe("baseTokens", () => {
  it("an hsl() fallback, its dark value by media query, and light-dark() inside @supports: @supports wins", () => {
    const css = `:root { color-scheme: light dark; --color-text: hsl(0 0% 10%); --color-primary: hsl(340 80% 40%); }
@media (prefers-color-scheme: dark) { :root { --color-text: hsl(0 0% 90%); --color-primary: hsl(80 80% 60%); } }
@supports (color: light-dark(oklch(0% 0 0deg), oklch(0% 0 0deg))) {
  :root { --color-text: light-dark(oklch(27.9% 0.029 247deg), oklch(86.9% 0.014 248deg)); }
}`;
    expect(entries(css)).toEqual({
      "--color-text": { light: "oklch(27.9% 0.029 247deg)", dark: "oklch(86.9% 0.014 248deg)" },
      // Not in @supports: the fallback pair is the value.
      "--color-primary": { light: "hsl(340 80% 40%)", dark: "hsl(80 80% 60%)" },
    });
  });

  it("the storefront starter's colours, as Sass compiles them: light-dark() on :root, no @supports", async () => {
    const file = fileURLToPath(new URL("../../cli/templates/storefront-system/src/styles/base/colors.scss", import.meta.url));
    const css = await compileSassFile(file);
    const tokens = entries(css);
    expect(tokens["--color-text"]).toEqual({ light: "#1b1b1f", dark: "#eceef2" });
    expect(tokens["--color-primary"]).toEqual({ light: "#0b5cad", dark: "#7ab8ff" });
    expect(baseTokens(css).unresolved.size).toBe(0);
    expect(await readFile(file, "utf8")).toContain("light-dark(#1b1b1f, #eceef2)");
  });

  it("a plain value is light and dark alike; var() is followed in each mode, through a chain", () => {
    const css = `:root { --color-brand: light-dark(#111, #eee); --color-accent: var(--color-brand); --color-link: var(--color-accent);
  --color-line: #888; --color-on: var(--missing, #fff); --radius: 4px; }`;
    expect(entries(css)).toEqual({
      "--color-brand": { light: "#111", dark: "#eee" },
      "--color-accent": { light: "#111", dark: "#eee" },
      "--color-link": { light: "#111", dark: "#eee" },
      "--color-line": { light: "#888", dark: "#888" },
      "--color-on": { light: "#fff", dark: "#fff" },
    });
  });

  it("html counts as :root; a theme's or a component's rule does not", () => {
    const css = `html { --color-a: #111; } [data-theme=dark] { --color-a: #222; --color-b: #333; } .card { --color-c: #444; }`;
    expect(entries(css)).toEqual({ "--color-a": { light: "#111", dark: "#111" } });
  });

  it("what can't be resolved is reported, never guessed", () => {
    const css = `:root { --color-loop: var(--color-loop2); --color-loop2: var(--color-loop); --color-gone: var(--color-nowhere);
  --color-half: light-dark(#111); }
@media (prefers-color-scheme: dark) { :root { --color-dark-only: #000; } }`;
    const r = baseTokens(css);
    expect(r.tokens.size).toBe(0);
    expect([...r.unresolved.keys()].sort()).toEqual(["--color-dark-only", "--color-gone", "--color-half", "--color-loop", "--color-loop2"]);
    expect(r.unresolved.get("--color-gone")).toMatch(/--color-nowhere.*not declared/);
    expect(r.unresolved.get("--color-loop")).toMatch(/refers to itself/);
  });
});

// ---- The custom properties a rule reads and declares, for the graph ----

describe("varNames", () => {
  it("names each var() once, one in another's fallback and one in calc() too", () => {
    expect(varNames("calc(var(--a) + var(--b, var(--c, 1px))) var(--a)")).toEqual(["--a", "--b", "--c"]);
    expect(varNames("1px solid red")).toEqual([]);
  });
});

describe("selectorAnchors", () => {
  it("keys a rule to the class of its rightmost compound that has one, the classes before it as context", () => {
    expect(selectorAnchors(".card")).toEqual([{ classes: ["card"], within: [] }]);
    expect(selectorAnchors(".card.is-on:hover")).toEqual([{ classes: ["card", "is-on"], within: [] }]);
    expect(selectorAnchors(".tile .card")).toEqual([{ classes: ["card"], within: ["tile"] }]);
    expect(selectorAnchors(".card > div")).toEqual([{ classes: ["card"], within: [] }]);
    expect(selectorAnchors(".a + .b ~ .c > span")).toEqual([{ classes: ["c"], within: ["a", "b"] }]);
  });

  it("leaves a class in a pseudo-class's argument out, and gives a selector with no class none", () => {
    expect(selectorAnchors(".card:not(.off)")).toEqual([{ classes: ["card"], within: [] }]);
    expect(selectorAnchors(":root, body")).toEqual([{ classes: [], within: [] }, { classes: [], within: [] }]);
  });
});

describe("propertyFacts", () => {
  const css = [
    ":root { --gap: 1rem; --x: var(--gap); }",
    "@media (prefers-color-scheme: dark) { :root { --dark-only: #000; } }",
    "@property --angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }",
    ".card { padding: var(--gap); color: var(--fg, var(--fallback)); }",
    ".card:hover { padding: var(--gap); }",
    ".tile .card { margin: var(--gap); }",
    "body { margin: var(--gap); }",
  ].join("\n");
  const facts = propertyFacts(css, "/x/a.css");

  it("declares each property once, with the first selector and the at-rule it sits in", () => {
    expect([...facts.declares]).toEqual([
      ["--gap", { selector: ":root", context: "plain" }],
      ["--x", { selector: ":root", context: "plain" }],
      ["--dark-only", { selector: ":root", context: "media-dark" }],
      ["--angle", { selector: "@property --angle", context: "plain" }],
    ]);
  });

  it("reads each use once per property, class and context, a nested fallback's too", () => {
    expect(facts.uses).toEqual([
      { property: "--gap", class: null, within: [], selector: ":root" },
      { property: "--gap", class: "card", within: [], selector: ".card" },
      { property: "--fg", class: "card", within: [], selector: ".card" },
      { property: "--fallback", class: "card", within: [], selector: ".card" },
      { property: "--gap", class: "card", within: ["tile"], selector: ".tile .card" },
    ]);
  });

  it("gives nothing for text that doesn't parse", () => {
    expect(propertyFacts("}}} .a {", "/x/a.css")).toEqual({ uses: [], declares: new Map() });
  });
});
