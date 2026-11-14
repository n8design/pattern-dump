// Collections: a pages folder is a collection, and its entries are what a listing shows of its pages. A folder's
// index.md lists them as `page.children` (derived.ts); any page shows them as `site.collections.<name>` when the
// skin lists the name (the folder's path, "articles" or "blog/news") in partials/base's schema, as it lists
// navigations.
//
// A listed name the pages folder has no folder for is an empty list and a note, or an error when the skin requires it.
//
// An entry has Pattern Dump's fixed shape: route, title, description (the page's, else its first paragraph),
// date, image, tags, draft. Its date is the page's `date`, else the day git first saw it (`page.created`), else
// null. In pd build a page whose date would come from a shallow clone stops the listing, as a layout that shows
// dates does. The folder's `sort`: "order" (the default) keeps the folder's order, "date" puts the newest first,
// ties by route; a page with no date at all is then a problem in pd build and a note in pd dev, where it sorts
// last.

import { suggest } from "@pattern-dump/config";
import type { DatesMode, GitDates } from "./git-dates.js";
import type { PageModel } from "./pages.js";

/** One page in a listing. */
export interface Entry {
  route: string;
  title: string;
  description: string | null;
  date: string | null;
  image: string | null;
  tags: string[];
  draft: boolean;
}

export interface Listed {
  entries: Entry[];
  problems: string[];
  notes: string[];
}

/** The date of the page at `route`: its own, else the day git first saw it. */
export async function dateOf(route: string, model: PageModel, dates: GitDates | undefined, mode: DatesMode)
  : Promise<{ date: string | null; problems: string[]; notes: string[] }> {
  const own = model.entries.get(route)?.date ?? null;
  const file = model.files.get(route);
  if (own !== null || !dates || !file) return { date: own, problems: [], notes: [] };
  const dated = await dates.of(file.path, mode);
  return { date: dated.shallow && mode === "build" ? null : dated.dates.created?.slice(0, 10) ?? null, problems: dated.problems, notes: dated.notes };
}

/** The entries of the folder at `folder` (a route: "/articles/"), sorted as its index.md says. */
export async function entriesOf(folder: string, model: PageModel, o: { dates?: GitDates | undefined; mode: DatesMode }): Promise<Listed> {
  const listing = model.folders.get(folder);
  if (!listing) return { entries: [], problems: [], notes: [] };
  const titles = new Map(model.pages.map(p => [p.route, p.title]));
  const problems: string[] = [], notes: string[] = [];
  const entries: Entry[] = [];
  for (const route of listing.children) {
    const fields = model.entries.get(route);
    if (!fields) continue;
    const dated = await dateOf(route, model, o.dates, o.mode);
    problems.push(...dated.problems);
    // Why a date is missing matters where the order depends on it.
    if (listing.sort === "date") notes.push(...dated.notes);
    entries.push({ route, title: titles.get(route) ?? route, ...fields, date: dated.date });
  }
  if (listing.sort === "date") {
    const index = model.files.get(folder)!.path;
    for (const e of entries.filter(e => e.date === null)) {
      const text = `${index}: sort: date, but ${model.files.get(e.route)!.path} has no date: give it one (date: YYYY-MM-DD), or commit it so git dates it`;
      if (o.mode === "build") problems.push(text); else notes.push(`${text}; it is listed last`);
    }
    entries.sort((a, b) => a.date === b.date ? (a.route < b.route ? -1 : 1)
      : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? 1 : -1);
  }
  return { entries, problems: [...new Set(problems)], notes: [...new Set(notes)] };
}

export const COLLECTIONS_KEY = "collections";
type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * What partials/base lists under site.collections (`declared`, its schema there): names only, each a folder's path
 * in the pages folder, with no shape of their own. `folders`: every folder's path ("articles", "blog/news");
 * `leftOut`: the drafts a build leaves out (a name whose folder's index.md is one of them is an empty list, not an
 * error). `configured`: storefront.site from the config, which can't set collections.
 */
export function checkCollections(
  declared: Obj | undefined, owner: string, folders: ReadonlySet<string>, leftOut: readonly string[], configured: Obj | undefined,
): { listed: string[]; problems: string[]; notes: string[] } {
  const problems: string[] = [], notes: string[] = [];
  if (configured && Object.hasOwn(configured, COLLECTIONS_KEY)) {
    problems.push(`storefront.site.${COLLECTIONS_KEY} is filled by Pattern Dump from the pages folders: list the names in ${owner}'s schema, and don't set it in the config`);
  }
  if (!declared) return { listed: [], problems, notes };
  const names = isObject(declared["properties"]) ? declared["properties"] : {};
  const extra = Object.keys(declared).filter(k => !["type", "description", "title", "properties", "required"].includes(k));
  if (extra.length || (declared["type"] !== undefined && declared["type"] !== "object")) {
    problems.push(`${owner} declares a shape for site.${COLLECTIONS_KEY}: the shape of an entry is Pattern Dump's, so list the folders' names under properties only`);
  }
  const required = Array.isArray(declared["required"]) ? declared["required"].map(String) : [];
  const listed = [...new Set([...Object.keys(names), ...required])];
  for (const name of listed) {
    const schema = names[name];
    const own = Object.keys(isObject(schema) ? schema : {}).filter(k => k !== "description" && k !== "title");
    if (own.length) {
      problems.push(`${owner} declares ${own.map(k => `"${k}"`).join(", ")} for site.${COLLECTIONS_KEY}.${name}: the shape of an entry is Pattern Dump's, so list the name only (a description at most)`);
    }
    // A skin can list a collection a site doesn't have (a skin is shared): an empty list, and a note naming the
    // nearest folder, unless the skin requires it.
    if (!folders.has(name) && !leftOut.includes(`${name}/index.md`)) {
      const near = suggest(name, [...folders]);
      const text = `${owner} lists site.${COLLECTIONS_KEY}.${name}, but the pages folder has no folder "${name}" with an index.md`;
      const hint = near ? ` — did you mean "${near}"?` : folders.size ? ` (its folders: ${[...folders].map(f => `"${f}"`).join(", ")})` : "";
      if (required.includes(name)) problems.push(`${text}, and ${owner} requires it${hint}`);
      else notes.push(`${text}, so it is an empty list${hint}`);
    }
  }
  return { listed, problems, notes };
}

/** Every listed collection's entries, by name, for the page being rendered. */
export async function resolveCollections(listed: readonly string[], model: PageModel, o: { dates?: GitDates | undefined; mode: DatesMode })
  : Promise<{ collections: Record<string, Entry[]>; problems: string[]; notes: string[] }> {
  const collections: Record<string, Entry[]> = {};
  const problems: string[] = [], notes: string[] = [];
  for (const name of listed) {
    const r = await entriesOf(`/${name}/`, model, o);
    collections[name] = r.entries;
    problems.push(...r.problems);
    notes.push(...r.notes);
  }
  return { collections, problems, notes };
}
