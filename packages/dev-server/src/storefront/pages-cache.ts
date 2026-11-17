// The storefront's page model (pages.ts), kept between requests: reading it means reading and parsing every page
// file, and every page request needs it.
//
//  - pd build (`once`): the pages folder doesn't change while a build runs, so it is read once for the build.
//  - pd dev, and any other server: the model is kept only while the pages folder is as it was when the model was
//    read. Before each use the folder is listed and every file's size and time stamps are compared (no file is
//    read), so a new, changed, renamed or deleted page is seen by the next request, with or without the watcher.
//
// `options` names everything else the reading depends on (the day, the skin's layouts): another value is another
// reading. One model is held at a time. Callers share it, so it is frozen, all the way down: code that changes it
// (a project's helper among them) throws a TypeError instead of changing every later page.

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

/** A Map's or Set's methods that change it: Object.freeze leaves its entries open, so these throw instead. */
const CHANGES = ["set", "add", "delete", "clear"] as const;

/** `value` frozen with everything it holds: objects, arrays, and the keys and values of maps and sets. */
export function frozen<T>(value: T): T {
  const seen = new Set<object>();
  const freeze = (v: unknown): void => {
    // A typed array's elements can't be frozen (freezing one throws); the model holds none.
    if (v === null || typeof v !== "object" || seen.has(v) || ArrayBuffer.isView(v)) return;
    seen.add(v);
    if (v instanceof Map || v instanceof Set) {
      for (const name of CHANGES) {
        if (name in v) {
          Object.defineProperty(v, name, {
            value: () => { throw new TypeError(`Cannot ${name} in a read-only ${v instanceof Map ? "Map" : "Set"}`); },
          });
        }
      }
      for (const [k, item] of v.entries()) { freeze(k); freeze(item); }
    } else {
      for (const key of Reflect.ownKeys(v)) freeze((v as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(v);
  };
  freeze(value);
  return value;
}

/** A TypeError from changing something frozen: an assignment, a new or deleted property, or a frozen Map or Set. */
const READ_ONLY = /^Cannot (?:assign to read only property|add property|delete property|define property|redefine property|set in|add in|delete in|clear in) /;

/** What a render that failed says: its error's message, and for a change to something frozen (the page model, which
 *  every page shares) why it is read-only and where the change was made, since the bare message names neither. */
export function renderError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  // The renderer explains a write to a render's data itself (it names the component); said once is enough.
  if (!(e instanceof TypeError) || !READ_ONLY.test(e.message) || e.message.includes(", so it is read-only:")) return e.message;
  // The first frame of the stack is the code that made the change (a project helper, say).
  const at = /\n\s+at (.+)/.exec(e.stack ?? "")?.[1];
  return `${e.message}. The storefront's page data is shared by every page, so it is read-only: copy a value before `
    + `changing it${at ? ` (changed at ${at})` : ""}`;
}

export function createPagesCache(pagesDir: string, once: boolean): PagesCache {
  let held: { key: string; model: Promise<PageModel> } | undefined;
  return {
    async get(options, read) {
      // The fingerprint is taken before the reading: a file that changes in between gives a model newer than its
      // key, and the next request reads again. A held model is never older than its key.
      const key = once ? options : `${options}\n${await pagesFingerprint(pagesDir)}`;
      if (held?.key === key) return held.model;
      const entry = { key, model: read().then(frozen) };
      held = entry;
      // A reading that failed is not kept: the next request reads again.
      entry.model.catch(() => { if (held === entry) held = undefined; });
      return entry.model;
    },
  };
}
