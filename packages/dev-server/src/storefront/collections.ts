// Collections: a pages folder is a collection, and its entries are what a listing shows of its pages. A folder's
// index.md lists them as `page.children` (derived.ts); any page shows them as `site.collections.<name>` when the
// skin lists the name (the folder's path, "articles" or "blog/news") in partials/base's schema, as it lists
// navigations.
//
// An entry has Pattern Dump's fixed shape: route, title, description (the page's, else its first paragraph),
// date, image, tags, draft. Its date is the page's `date`, else the day git first saw it (`page.created`), else
// null. In pd build a page whose date would come from a shallow clone stops the listing, as a layout that shows
// dates does. The folder's `sort`: "order" (the default) keeps the folder's order, "date" puts the newest first,
// ties by route; a page with no date at all is then a problem in pd build and a note in pd dev, where it sorts
// last.

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
