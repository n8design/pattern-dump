// The storefront's page model (pages.ts), kept between requests: reading it means reading and parsing every page
// file, and every page request needs it.
//
//  - pd build (`once`): the pages folder doesn't change while a build runs, so it is read once for the build.
//  - pd dev, and any other server: the model is kept only while the pages folder is as it was when the model was
//    read. Before each use the folder is listed and every file's size and time stamps are compared (no file is
//    read), so a new, changed, renamed or deleted page is seen by the next request, with or without the watcher.
//
// `options` names everything else the reading depends on (the day, the skin's layouts): another value is another
// reading. One model is held at a time. Callers share it, so they read it and never change it.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PageModel } from "./pages.js";

export interface PagesCache {
  /** The model for `options`: the held one while it is current, else what `read` gives, held from then on. */
  get(options: string, read: () => Promise<PageModel>): Promise<PageModel>;
}

/** What the pages folder holds now: every entry under it by its path, each file with its size and time stamps.
 *  A link is followed, as reading the page follows it. */
export async function pagesFingerprint(pagesDir: string): Promise<string> {
  const entries = await readdir(pagesDir, { recursive: true, withFileTypes: true }).catch(() => null);
  if (entries === null) return "no folder";
  const lines = await Promise.all(entries.map(async e => {
    const path = join(e.parentPath, e.name);
    if (e.isDirectory()) return `${path}/`;
    const s = await stat(path).catch(() => null);
    return s ? `${path}\0${s.size}\0${s.mtimeMs}\0${s.ctimeMs}` : `${path}\0gone`;
  }));
  return lines.sort().join("\n");
}

export function createPagesCache(pagesDir: string, once: boolean): PagesCache {
  let held: { key: string; model: Promise<PageModel> } | undefined;
  return {
    async get(options, read) {
      // The fingerprint is taken before the reading: a file that changes in between gives a model newer than its
      // key, and the next request reads again. A held model is never older than its key.
      const key = once ? options : `${options}\n${await pagesFingerprint(pagesDir)}`;
      if (held?.key === key) return held.model;
      const entry = { key, model: read() };
      held = entry;
      // A reading that failed is not kept: the next request reads again.
      entry.model.catch(() => { if (held === entry) held = undefined; });
      return entry.model;
    },
  };
}
