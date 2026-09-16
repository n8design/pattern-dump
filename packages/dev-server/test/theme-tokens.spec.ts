// Swatch tokens read from compiled theme CSS (the no-sidecar path).
//
// Sass drops the quotes from an attribute selector — `[data-theme="dark"]` compiles to
// `[data-theme=dark]` — and extraction matched the quoted spelling only, so every theme without a
// .theme.json sidecar showed empty swatches. Both spellings are the same selector.

import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileSassFile } from "@pattern-dump/build";
import { extractThemeTokens } from "../src/themes.js";

const slots = ["--surface", "--primary", "--missing"];

describe("extractThemeTokens — compiled CSS, no sidecar", () => {
  it("reads tokens from a theme as Sass actually compiles it (quotes stripped)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pd-theme-tokens-"));
    try {
      const scss = join(dir, "dark.theme.scss");
      await writeFile(scss, '[data-theme="dark"] {\n  --surface: #16181d;\n  --primary: #7ab8ff;\n}\n');
      const css = await compileSassFile(scss);
      expect(css).toContain("[data-theme=dark]");
      expect(await extractThemeTokens("dark", css, slots, dir))
        .toEqual({ "--surface": "#16181d", "--primary": "#7ab8ff", "--missing": null });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts quoted, single-quoted and unquoted selectors, and ignores other themes and :root", async () => {
    const css = [
      ":root { --surface: #root; }",
      '[data-theme="light"] { --surface: #light; }',
      "[data-theme='dark'] { --surface: #dark; }",
      "[data-theme=dark] { --primary: #dark2; }",
    ].join("\n");
    expect(await extractThemeTokens("dark", css, slots, "/nonexistent"))
      .toEqual({ "--surface": "#dark", "--primary": "#dark2", "--missing": null });
  });
});
