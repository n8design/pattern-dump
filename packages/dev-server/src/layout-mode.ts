// Preview layout-mode resolution.
//
// A LEAF: pure filesystem reads over explicit arguments, no server state. Four callers depend on it
// (component tree, component detail, folder overview, and the /preview route), which is why it is
// its own module rather than living with any one of them.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readFolderFile, type PatternDirs } from "./pattern-dirs.js";
import type { DiscoveryMap, LayoutMode } from "@pattern-dump/contracts";

/**
 * Categories that default to `full` preview layout. A page or template is a whole document, so it
 * fills the stage; everything else is centered content. Overridable per-category and per-component.
 */
export const FULL_CATEGORIES = new Set(["pages", "templates"]);

/**
 * Resolve a component's preview layout, most-specific-wins:
 *   category default (FULL_CATEGORIES) → category index.md → the component's own .md
 *
 * A missing or unreadable .md is not an error — it just leaves the broader default in place.
 */
export async function resolveLayoutMode(
  componentId: string,
  patternsDir: PatternDirs,
  discoveryMap?: DiscoveryMap
): Promise<LayoutMode> {
  const parts    = componentId.split("/");
  const category = parts[0];

  let layout: LayoutMode = FULL_CATEGORIES.has(category) ? "full" : "centered";

  const categoryIndex = await readFolderFile(patternsDir, join(category, "index.md"));
  if (categoryIndex !== null) {
    const m = categoryIndex.match(/^preview:\s*(centered|full)$/m);
    if (m) layout = m[1] as LayoutMode;
  }

  const mdPath = discoveryMap?.get(componentId)?.mdPath;
  if (mdPath) {
    try {
      const md = await readFile(mdPath, "utf-8");
      const m  = md.match(/^preview:\s*(centered|full)$/m);
      if (m) layout = m[1] as LayoutMode;
    } catch { /* no component .md */ }
  }

  return layout;
}
