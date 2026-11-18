// Preview layout-mode resolution.
//
// A LEAF: pure filesystem reads over explicit arguments, no server state. Four callers depend on it
// (component tree, component detail, folder overview, and the /preview route), which is why it is
// its own module rather than living with any one of them.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readFolderFile, type PatternDirs } from "./pattern-dirs.js";
import type { DiscoveryMap, LayoutMode } from "@pattern-dump/contracts";
import { stripOrderPrefixes } from "@pattern-dump/discovery";
import { parseJson, readPreviewMode } from "@pattern-dump/renderer";
import { frontmatterString, readFrontmatter } from "./frontmatter.js";

/**
 * Categories that default to `full` preview layout. A page, a template or a layout is a whole
 * document, so it fills the stage; everything else is centered content. Overridable per-category and per-component.
 * Matched without ordering prefixes, so a PatternLab tree's `05-pages` counts (see stripOrderPrefixes).
 */
export const FULL_CATEGORIES = new Set(["pages", "templates", "layouts"]);

/** `preview:` from a pattern `.md` or folder `index.md` frontmatter, when it names a layout mode. */
export function previewModeOf(md: string): LayoutMode | undefined {
  const v = frontmatterString(readFrontmatter(md), "preview");
  return v === "centered" || v === "full" ? v : undefined;
}

/**
 * Resolve a component's preview layout, most-specific-wins:
 *   category default (FULL_CATEGORIES), then the category index.md `preview:`, then the schema's
 *   `x-pd-preview`, then the component's own .md `preview:`
 *
 * A missing or unreadable .md or schema is not an error here: it just leaves the broader default in
 * place. An invalid `x-pd-preview` is reported by the schema check (checkSchemaExtensions) and ignored.
 */
export async function resolveLayoutMode(
  componentId: string,
  patternsDir: PatternDirs,
  discoveryMap?: DiscoveryMap
): Promise<LayoutMode> {
  const parts    = componentId.split("/");
  const category = parts[0];

  let layout: LayoutMode = FULL_CATEGORIES.has(stripOrderPrefixes(category)) ? "full" : "centered";

  // The raw category here: it is a folder on disk, prefix and all.
  const categoryIndex = await readFolderFile(patternsDir, join(category, "index.md"));
  if (categoryIndex !== null) layout = previewModeOf(categoryIndex) ?? layout;

  const schemaPath = discoveryMap?.get(componentId)?.schemaPath;
  if (schemaPath) {
    try {
      const parsed = parseJson(await readFile(schemaPath, "utf-8"));
      const mode = parsed.ok ? readPreviewMode(parsed.value).mode : undefined;
      if (mode) layout = mode;
    } catch { /* unreadable schema */ }
  }

  const mdPath = discoveryMap?.get(componentId)?.mdPath;
  if (mdPath) {
    try {
      layout = previewModeOf(await readFile(mdPath, "utf-8")) ?? layout;
    } catch { /* no component .md */ }
  }

  return layout;
}
