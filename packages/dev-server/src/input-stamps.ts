// What pd build read, as it was when the build started: every file under each input folder (and each input file),
// by its path, with its size and time stamps. No file is read. Taken again before the build writes, it shows a file
// saved, added or removed while the build ran: the build stops instead of writing output that is part old, part new.
// pd build runs no watcher, and the storefront is written as the crawl read it, so this is what notices.

import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export type InputStamps = Map<string, string>;

const inside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
};

/** The stamps of everything under `inputs` (folders or files; a missing one is recorded as missing), leaving out
 *  whatever is inside `skip` (the output folders). */
export async function stampInputs(inputs: readonly string[], skip: readonly string[] = []): Promise<InputStamps> {
  const stamps: InputStamps = new Map();
  const skipped = (p: string): boolean => skip.some(s => inside(p, s));
  const stampOf = async (path: string): Promise<void> => {
    if (stamps.has(path) || skipped(path)) return;
    const s = await stat(path).catch(() => null);
    stamps.set(path, s === null ? "missing" : s.isDirectory() ? "folder" : `${s.size}:${s.mtimeMs}:${s.ctimeMs}`);
  };
  for (const input of new Set(inputs)) {
    await stampOf(input);
    if (stamps.get(input) !== "folder") continue;
    const entries = await readdir(input, { recursive: true, withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(e => stampOf(join(e.parentPath, e.name))));
  }
  return stamps;
}

/** What differs between two stampings, one line each ("<path> (changed)", "added", "removed"), sorted; paths inside
 *  `root` are given from it. Empty when nothing changed. */
export function changedInputs(before: InputStamps, after: InputStamps, root: string): string[] {
  const shown = (p: string): string => inside(p, root) ? relative(root, p).split(sep).join("/") || "." : p;
  const lines: string[] = [];
  for (const [path, stamp] of after) {
    const was = before.get(path);
    if (was === undefined) lines.push(`${shown(path)} (added)`);
    else if (was !== stamp) lines.push(`${shown(path)} (${stamp === "missing" ? "removed" : "changed"})`);
  }
  for (const path of before.keys()) if (!after.has(path)) lines.push(`${shown(path)} (removed)`);
  return lines.sort();
}
