// Folder-level files (`index.md`) across several patterns folders — the project's own, then each
// pattern package's. Components already carry absolute paths through the discovery map; FOLDERS
// have no entry, so a folder's index.md is looked up in every patterns folder, project first.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** One patterns folder, or several in precedence order (project first). */
export type PatternDirs = string | readonly string[];

/** The text of the first `<dir>/<rel>` that exists, in precedence order; null when none does. */
export async function readFolderFile(dirs: PatternDirs, rel: string): Promise<string | null> {
  for (const dir of typeof dirs === "string" ? [dirs] : dirs) {
    try { return await readFile(join(dir, rel), "utf-8"); } catch { /* not in this folder */ }
  }
  return null;
}
