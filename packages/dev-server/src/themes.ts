// Theme discovery + swatch-token extraction.
//
// A LEAF: filesystem + postcss over explicit arguments, no server state.
//
// Token extraction has ONE source per theme, deliberately: if a `.theme.json` sidecar exists it is
// authoritative and a slot missing from it stays null — there is no CSS top-up. Mixing the two
// sources would make a swatch's provenance unknowable.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postcss from "postcss";
import type { ThemeSummary } from "@pattern-dump/contracts";

/** Every `*.theme.scss` across the theme folders, with the folder it lives in. A name already found
 *  in an earlier folder (the project's) hides a later one (a package's). */
export async function discoverThemeFiles(themesDirs: string | string[]): Promise<Array<{ name: string; dir: string }>> {
  const found = new Map<string, string>();
  for (const dir of Array.isArray(themesDirs) ? themesDirs : [themesDirs]) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory() || !e.name.endsWith(".theme.scss")) continue;
      const name = e.name.slice(0, -".theme.scss".length);
      if (!found.has(name)) found.set(name, dir);
    }
  }
  return [...found].map(([name, dir]) => ({ name, dir }));
}

export async function discoverThemes(themesDirs: string | string[]): Promise<ThemeSummary[]> {
  return (await discoverThemeFiles(themesDirs)).map(({ name }) => ({ name }));
}

export async function extractThemeTokens(
  name: string,
  compiledCss: string,
  slots: string[],
  themesDir: string
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = Object.fromEntries(slots.map(s => [s, null]));

  // Step 1 — sidecar (.theme.json) is the authoritative source when present.
  // A slot absent from the sidecar stays null — no CSS top-up.
  // One source per theme: if the sidecar exists, it is the sole source.
  const jsonPath = join(themesDir, `${name}.theme.json`);
  try {
    const raw = JSON.parse(await readFile(jsonPath, "utf-8")) as Record<string, string>;
    for (const slot of slots) {
      const key = slot.replace(/^--/, "");  // "--bodyBackground" → "bodyBackground"
      if (key in raw) result[slot] = raw[key];
    }
    return result;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // ENOENT = no sidecar → fall through silently to CSS parse.
      // Any other error (e.g. malformed JSON) → warn loudly; don't silently mask.
      console.warn(`[pd] extractThemeTokens: failed to parse ${jsonPath}:`, err);
    }
  }

  // Step 2 — postcss-parse compiled CSS, scoped strictly to [data-theme="name"].
  // Scoped to the named rule to avoid attributing :root defaults or base-layer
  // declarations to this theme.
  //
  // Matched in any quoting: Sass compiles `[data-theme="dark"]` to `[data-theme=dark]`, so matching
  // the quoted spelling alone found nothing and every sidecar-less theme showed empty swatches.
  const wanted = `[data-theme=${name}]`;
  const unquote = (selector: string): string => selector.replace(/=\s*(["'])(.*?)\1\s*\]/g, "=$2]").replace(/\s+/g, "");
  const root = postcss.parse(compiledCss);
  root.walkRules(rule => {
    if (!rule.selectors.some(sel => unquote(sel) === wanted)) return;
    rule.walkDecls(decl => {
      if (slots.includes(decl.prop)) result[decl.prop] = decl.value;
    });
  });
  // Note: .theme.json edits without a companion .theme.scss change won't trigger
  // re-extraction (HMR only watches .scss). Acceptable for static fixtures.
  return result;
}
