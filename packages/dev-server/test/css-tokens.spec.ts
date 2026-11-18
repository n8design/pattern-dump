// The colour tokens of the document base layer, read from compiled CSS (css-tokens.ts): the values a symbol image's
// standalone file declares. Three shapes real projects compile to, and the cases that must fail instead of guessing.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileSassFile } from "@pattern-dump/build";
import { baseTokens } from "../src/css-tokens.js";

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
