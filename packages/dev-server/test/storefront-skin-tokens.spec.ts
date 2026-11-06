// The storefront bench's skin takes every colour from its tokens, so a site rebrands it by setting
// --sk-accent alone. Read from the skin's SCSS sources, comments removed.
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const styles = fileURLToPath(new URL("../../../storefront-bench/src/styles/", import.meta.url));
const TOKENS = "site/tokens.scss";

async function sources(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(styles, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".scss")) continue;
    const file = join(entry.parentPath, entry.name);
    const text = await readFile(file, "utf8");
    out.set(relative(styles, file), text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));
  }
  return out;
}

// A colour written out, or one mixed from others: both belong in the tokens file.
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:oklch|oklab|lch|lab|rgba?|hsla?|hwb|color|color-mix|light-dark)\(/gi;

describe("the skin's colours", () => {
  it("are written only in the tokens file", async () => {
    const found: string[] = [];
    for (const [file, text] of await sources()) {
      if (file === TOKENS) continue;
      for (const m of text.matchAll(COLOUR_LITERAL)) found.push(`${file}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });

  it("use only tokens the tokens file defines", async () => {
    const all = await sources();
    const defined = new Set([...all.get(TOKENS)!.matchAll(/(--sk-[a-z0-9-]+)\s*:/g)].map(m => m[1]));
    const undefinedUses: string[] = [];
    for (const [file, text] of all) {
      for (const m of text.matchAll(/var\(\s*(--sk-[a-z0-9-]+)/g)) if (!defined.has(m[1])) undefinedUses.push(`${file}: ${m[1]}`);
    }
    expect(undefinedUses).toEqual([]);
  });

  it("derive every accent tint from --sk-accent, which is defined once", async () => {
    const tokens = (await sources()).get(TOKENS)!;
    expect([...tokens.matchAll(/--sk-accent\s*:/g)]).toHaveLength(1);
    // Every other token that mixes in a colour, or takes one with relative colour syntax (from …), takes
    // the accent token, not a second literal accent.
    const derived = [...tokens.matchAll(/(--sk-[a-z0-9-]+)\s*:([^;]*(?:color-mix\(|\bfrom\s)[^;]*);/g)];
    expect(derived.length).toBeGreaterThan(0);
    for (const [, name, body] of derived) {
      expect(body, name).toContain("var(--sk-accent)");
      for (const m of body.matchAll(/\bfrom\s+(var\([^)]*\)|[^\s]+)/g)) expect(m[1], name).toBe("var(--sk-accent)");
    }
  });

  it("never use the workbench shell's --pd- properties", async () => {
    const found = [...await sources()].filter(([, text]) => text.includes("--pd-")).map(([file]) => file);
    expect(found).toEqual([]);
  });
});
