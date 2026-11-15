// Queries: every list of pages that isn't a folder's own listing (related pages, a home page's latest articles). One
// mechanism, declared by a layout and overridden by a page.
//
//   - A layout names a query as a sub-key of `page` with `x-pd-query` on it: `page.related`, with its defaults,
//     `{ "collections": "same", "sort": "relevance", "limit": 3, "view": "compact" }`. Its name is lowercase letters
//     and digits, first a letter (camelCase allowed), and is no sub-key Pattern Dump fills.
//   - A page overrides one option at a time, with flat keys named after the query: `related-limit: 5`,
//     `related-pages: [articles/a.md]`. `related: false` turns it off. The keys are the build's, never the layout's.
//   - The layout gets `page.related` as `{ entries, listing }`: the pages, in the shape of a listing's entry, and the
//     same rendered through the query's view (null without a view, or when no page matched).
//
// What a query lists: its hand-picked `pages` first, in their order, then the pages of its `collections` (folders'
// paths, or `same`: the page's own folder; every folder without it) that match its `categories` and `tags` (`match`:
// any one, or all, of each list), sorted (`sort`: relevance, date or title; `order`: asc or desc), to `limit` pages in
// all. The current page is always left out, a page never comes twice, and drafts and scheduled pages never appear.
// Every value is checked, each problem at the line of the page's key or in the layout's declaration.

import { suggest } from "@pattern-dump/config";
import { QUERY_OPTIONS } from "@pattern-dump/renderer";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import type { FrontmatterReading, FrontmatterValue } from "../frontmatter.js";
import type { DatesMode, GitDates } from "./git-dates.js";
import type { PageModel } from "./pages.js";
import { entryOf, type Entry } from "./collections.js";
import { checkEntries, readCard, cardOf, type Card } from "./cards.js";
import { checkViewSampleData, viewOf, type ResolvedView } from "./views.js";
import { readCategories, readTags } from "./listing-keys.js";

export const QUERY_KEY = "x-pd-query";
export type QueryOption = typeof QUERY_OPTIONS[number];
/** The keyword for the page's own folder in `collections`. */
export const SAME = "same";
const SORTS = ["relevance", "date", "title"] as const;
const MATCHES = ["any", "all"] as const;
const ORDERS = ["asc", "desc"] as const;
const NAME = /^[a-z][a-zA-Z0-9]*$/;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A query a layout declares: its name (the sub-key of page), its defaults, and the card its entries name, if any. */
export interface DeclaredQuery { name: string; defaults: Obj; card?: string }

/** The queries a layout's schema declares (sub-keys of page with x-pd-query), in its order. */
export function declaredQueries(schema: unknown): DeclaredQuery[] {
  const page = isObject(schema) && isObject(schema["properties"]) ? schema["properties"]["page"] : undefined;
  const props = isObject(page) && isObject(page["properties"]) ? page["properties"] : {};
  const out: DeclaredQuery[] = [];
  for (const [name, prop] of Object.entries(props)) {
    if (!isObject(prop) || !Object.hasOwn(prop, QUERY_KEY)) continue;
    const entries = isObject(prop["properties"]) ? prop["properties"]["entries"] : undefined;
    const card = cardOf(entries);
    out.push({ name, defaults: isObject(prop[QUERY_KEY]) ? prop[QUERY_KEY] : {}, ...(card !== undefined ? { card } : {}) });
  }
  return out;
}

/** The frontmatter keys a page can set for the queries named `names`: each name, and `<name>-<option>`. */
export function queryKeys(names: readonly string[]): string[] {
  return names.flatMap(n => [n, ...QUERY_OPTIONS.map(o => `${n}-${o}`)]);
}

/**
 * Every problem with a layout's queries themselves: a name that can't be one (a sub-key Pattern Dump fills, a page
 * key the build or the layout already has), a declaration that isn't an object, sub-properties other than entries and
 * listing. `taken`: the sub-keys of page Pattern Dump fills and the ones it retired; `pageKeys`: the keys a page sets
 * for the build or for the layout itself.
 */
export function checkDeclaredQueries(schema: unknown, layoutId: string, taken: readonly string[], pageKeys: readonly string[]): string[] {
  const problems: string[] = [];
  const page = isObject(schema) && isObject(schema["properties"]) ? schema["properties"]["page"] : undefined;
  const props = isObject(page) && isObject(page["properties"]) ? page["properties"] : {};
  for (const q of declaredQueries(schema)) {
    const at = `${layoutId}: page.${q.name}`;
    if (taken.includes(q.name)) problems.push(`${at} is filled by Pattern Dump, so it can't be a query: give the query another name`);
    else if (!NAME.test(q.name)) problems.push(`${at}: a query's name is letters and digits, starting with a lowercase letter, such as "related"`);
    for (const key of queryKeys([q.name]).filter(k => pageKeys.includes(k))) {
      problems.push(`${at}: a page sets the query with "${key}", which is already a key of the page: give the query another name`);
    }
    const prop = props[q.name] as Obj;
    if (!isObject(prop[QUERY_KEY])) problems.push(`${at}: ${QUERY_KEY} must be an object of options (${QUERY_OPTIONS.join(", ")})`);
    const sub = isObject(prop["properties"]) ? Object.keys(prop["properties"]) : [];
    for (const k of sub.filter(k => k !== "entries" && k !== "listing")) {
      problems.push(`${at} declares "${k}": a query gives entries (its pages) and listing (them through its view) only`);
    }
  }
  return problems;
}

/** The value of one option, and where it was set: the page's line, or the layout's declaration. */
interface Set_ { value: unknown; at: string }

/** A query resolved for a page: its pages, and its view when it names one. */
export interface ResolvedQuery {
  name: string;
  entries: Entry[];
  view?: ResolvedView;
  problems: string[];
  notes: string[];
}

export interface QueryContext {
  route: string;
  /** The page's path in the pages folder. */
  path: string;
  frontmatter: FrontmatterReading;
  layoutId: string;
  model: PageModel;
  discoveryMap: DiscoveryMap;
  dates?: GitDates | undefined;
  mode: DatesMode;
}

const list = (v: unknown): string[] | undefined =>
  typeof v === "string" ? [v] : Array.isArray(v) && v.every(x => typeof x === "string") ? v as string[] : undefined;
const quoted = (xs: readonly string[]) => xs.map(x => `"${x}"`).join(", ");
const oneOf = (v: unknown, allowed: readonly string[], what: string): string | undefined => {
  if (typeof v === "string" && allowed.includes(v)) return undefined;
  const near = typeof v === "string" ? suggest(v, [...allowed]) : undefined;
  const all = allowed.map(a => `"${a}"`).join(", ").replace(/, ([^,]*)$/, " or $1");
  return `${what} ${JSON.stringify(v)} is not ${all}${near ? `: did you mean "${near}"?` : ""}`;
};

/** The folder a page is in, by route: "/articles/" for /articles/a/ and for /articles/sub/ (a folder's index.md). */
const folderOf = (route: string): string => route === "/" ? "/" : route.replace(/[^/]+\/$/, "");

/** The query `q` of the page at `ctx.route`: its options (the layout's, each replaced by the page's), checked, and
 *  the pages it lists. A page that turns it off gets none. */
export async function resolveQuery(q: DeclaredQuery, ctx: QueryContext): Promise<ResolvedQuery> {
  const problems: string[] = [], notes: string[] = [];
  const { values, lines } = ctx.frontmatter;
  const pageAt = (key: string) => `${ctx.path}${lines[key] !== undefined ? `:${lines[key]}` : ""}`;
  const layoutAt = `${ctx.layoutId} (${QUERY_KEY} of page.${q.name})`;
  const none = (): ResolvedQuery => ({ name: q.name, entries: [], problems, notes });

  // ---- the options: the layout's defaults, each replaced by the page's key ----
  const set: Partial<Record<QueryOption, Set_>> = {};
  for (const [k, v] of Object.entries(q.defaults)) {
    if ((QUERY_OPTIONS as readonly string[]).includes(k)) set[k as QueryOption] = { value: v, at: layoutAt };
    else {
      const near = suggest(k, [...QUERY_OPTIONS]);
      problems.push(`${layoutAt}: "${k}" is not an option of a query${near ? `: did you mean "${near}"?` : ""} (${QUERY_OPTIONS.join(", ")})`);
    }
  }
  for (const o of QUERY_OPTIONS) {
    const key = `${q.name}-${o}`;
    if (values[key] !== undefined) set[o] = { value: values[key] as FrontmatterValue, at: pageAt(key) };
  }
  let off = false;
  const toggle = values[q.name];
  if (toggle !== undefined) {
    if (toggle === "false") off = true;
    else if (toggle !== "true") {
      problems.push(`${pageAt(q.name)}: ${q.name} must be true or false (false turns the query off); its options are set with `
        + `${q.name}-<option>, such as ${q.name}-pages: [articles/a.md]`);
    }
  }

  // ---- each value, checked ----
  const { model } = ctx;
  const byPath = new Map([...model.files.values()].map(f => [f.path, f.route]));
  const draftPaths = new Set(model.drafts);
  const scheduledPaths = new Map(model.scheduled.map(s => [s.path, s.until]));
  const build = ctx.mode === "build";

  const picked: string[] = [];
  if (set.pages) {
    const paths = list(set.pages.value);
    if (!paths) problems.push(`${set.pages.at}: pages must be a list of pages, by their path in the pages folder, such as [articles/a.md]`);
    else {
      const seen = new Set<string>();
      for (const p of paths) {
        if (seen.has(p)) { problems.push(`${set.pages.at}: pages lists "${p}" twice`); continue; }
        seen.add(p);
        const route = byPath.get(p);
        const entry = route !== undefined ? model.entries.get(route) : undefined;
        const draft = draftPaths.has(p) || entry?.draft === true;
        const until = scheduledPaths.get(p);
        if (draft || until !== undefined || entry?.scheduled) {
          const why = draft ? "a draft" : `scheduled for ${until ?? entry?.date ?? "a later day"}`;
          const text = `${set.pages.at}: pages lists "${p}", which is ${why}, so pd build leaves it out`;
          if (build) problems.push(`${text}: publish it first, or take it out of the list`);
          else notes.push(`warning: ${text}; it is not listed`);
          continue;
        }
        if (route === undefined) {
          const near = suggest(p, [...byPath.keys()]);
          problems.push(`${set.pages.at}: pages lists "${p}", which is no page${near ? `: did you mean "${near}"?` : ""}`
            + ` (a page's path in the pages folder, such as "articles/a.md")`);
          continue;
        }
        if (route !== ctx.route) picked.push(route);
      }
    }
  }

  const folders = [...model.folders.keys()].filter(r => r !== "/").map(r => r.slice(1, -1));
  let pool: string[] | undefined; // undefined: every folder
  if (set.collections) {
    const names = list(set.collections.value);
    if (!names) problems.push(`${set.collections.at}: collections must be a folder's path, a list of them, or "${SAME}" (the page's own folder)`);
    else {
      pool = [];
      for (const n of names) {
        if (n === SAME) { pool.push(folderOf(ctx.route)); continue; }
        if (folders.includes(n)) { pool.push(`/${n}/`); continue; }
        // A folder pd build leaves out (its index.md is a draft or scheduled) is an empty collection, not a typo.
        if (draftPaths.has(`${n}/index.md`) || scheduledPaths.has(`${n}/index.md`)) continue;
        const near = suggest(n, [...folders, SAME]);
        problems.push(`${set.collections.at}: collections names "${n}", which is no folder of the pages: `
          + (near ? `did you mean "${near}"?` : folders.length ? `the folders are ${quoted(folders)}, or "${SAME}"` : `the pages have no folders; "${SAME}" is the page's own`));
      }
    }
  }

  let categories: string[] | undefined;
  if (set.categories) {
    const v = set.categories.value;
    const r = list(v) ? readCategories(v as FrontmatterValue, model.categories) : undefined;
    if (!r) problems.push(`${set.categories.at}: categories must be a category's key or a list of them`);
    else if (!r.ok) problems.push(`${set.categories.at}: ${r.message}`);
    else {
      categories = r.value.keys;
      for (const x of r.value.renamed) notes.push(`warning: ${set.categories.at}: category "${x.from}" is now "${x.to}" (renamed in storefront.categories): write "${x.to}"`);
    }
  }

  let tags: string[] | undefined;
  if (set.tags) {
    const v = set.tags.value;
    const r = list(v) ? readTags(v as FrontmatterValue) : undefined;
    if (!r) problems.push(`${set.tags.at}: tags must be a tag or a list of them`);
    else if (!r.ok) problems.push(`${set.tags.at}: ${r.message}`);
    else {
      // Tags aren't declared: a tag no page has is a typo, or a query that can never match.
      const used = [...new Set([...model.entries.values()].flatMap(e => e.tags))].sort();
      for (const t of r.value.filter(t => !used.includes(t))) {
        const near = suggest(t, used);
        problems.push(`${set.tags.at}: no page has the tag "${t}"${near ? `: did you mean "${near}"?` : used.length ? ` (the tags pages have: ${quoted(used)})` : ""}`);
      }
      tags = r.value;
    }
  }

  const enumOf = <T extends string>(o: QueryOption, allowed: readonly T[]): T | undefined => {
    const s = set[o];
    if (!s) return undefined;
    const problem = oneOf(s.value, allowed, o);
    if (problem) { problems.push(`${s.at}: ${problem}`); return undefined; }
    return s.value as T;
  };
  const match = enumOf("match", MATCHES) ?? "any";
  const sort = enumOf("sort", SORTS) ?? "date";
  const order = enumOf("order", ORDERS);
  if (order !== undefined && sort === "relevance") {
    problems.push(`${set.order!.at}: order doesn't go with sort: relevance, which always puts the most relevant first: leave order out, or sort by date or title`);
  }

  let limit: number | undefined;
  if (set.limit) {
    const v = set.limit.value;
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 1) problems.push(`${set.limit.at}: limit ${JSON.stringify(v)} is not a number of pages: a whole number from 1, such as 3`);
    else limit = n;
  }
  if (limit !== undefined && set.pages && picked.length > limit) {
    problems.push(`${set.pages.at}: pages lists ${picked.length} pages, more than the limit of ${limit} (${set.limit!.at}): raise the limit, or pick fewer`);
  }

  let view: ResolvedView | undefined;
  if (set.view) {
    if (typeof set.view.value !== "string") problems.push(`${set.view.at}: view must be one view's name, such as "compact"`);
    else {
      const r = await viewOf(set.view.value, set.view.at, ctx.discoveryMap);
      problems.push(...r.problems);
      view = r.view;
    }
  }
  let card: Card | undefined;
  if (q.card !== undefined) {
    const r = await readCard(q.card, ctx.layoutId, `the card of page.${q.name}`, ctx.discoveryMap);
    problems.push(...r.problems);
    card = r.card;
  }
  if (problems.length) return none();
  if (off) return { name: q.name, entries: [], ...(view ? { view } : {}), problems, notes };

  // ---- the pages ----
  const routes = pool ?? [...model.folders.keys()];
  const seen = new Set<string>([ctx.route, ...picked]);
  const candidates: string[] = [];
  for (const folder of routes) {
    for (const r of model.folders.get(folder)?.children ?? []) {
      if (seen.has(r)) continue;
      const e = model.entries.get(r);
      if (!e || e.draft || e.scheduled) continue;
      seen.add(r);
      candidates.push(r);
    }
  }
  const matches = (have: readonly string[], want: readonly string[] | undefined) =>
    want === undefined || want.length === 0 || (match === "all" ? want.every(w => have.includes(w)) : want.some(w => have.includes(w)));
  const filtered = candidates.filter(r => {
    const e = model.entries.get(r)!;
    return matches(e.tags, tags) && matches(e.categories.map(c => c.key), categories);
  });

  const entries: Entry[] = [];
  const take = async (r: string): Promise<Entry | undefined> => {
    const got = await entryOf(r, model, { dates: ctx.dates, mode: ctx.mode });
    problems.push(...got.problems);
    return got.entry;
  };
  for (const r of picked) { const e = await take(r); if (e) entries.push(e); }
  const filled: Entry[] = [];
  for (const r of filtered) { const e = await take(r); if (e) filled.push(e); }

  const own = model.entries.get(ctx.route);
  const ownKeys = new Set([...(own?.tags ?? []).map(t => `t:${t}`), ...(own?.categories ?? []).map(c => `c:${c.key}`)]);
  const relevance = (e: Entry) => e.tags.filter(t => ownKeys.has(`t:${t}`)).length + e.categories.filter(c => ownKeys.has(`c:${c.key}`)).length;
  const collator = new Intl.Collator("en", { sensitivity: "base" });
  const byRoute = (a: Entry, b: Entry) => a.route < b.route ? -1 : a.route > b.route ? 1 : 0;
  /** Newest first; a page with no date last. */
  const byDate = (a: Entry, b: Entry) => a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? 1 : -1;
  const flip = (n: number) => -n;
  filled.sort((a, b) => {
    if (sort === "relevance") return (relevance(b) - relevance(a)) || byDate(a, b) || byRoute(a, b);
    if (sort === "title") {
      const t = collator.compare(a.title, b.title) || byRoute(a, b);
      return order === "desc" ? flip(t) : t;
    }
    // A page with no date stays last either way.
    if (order === "asc" && a.date !== null && b.date !== null) return flip(byDate(a, b)) || byRoute(a, b);
    return byDate(a, b) || byRoute(a, b);
  });
  entries.push(...filled);
  const listed = limit !== undefined ? entries.slice(0, limit) : entries;

  // ---- each page against the view's card, and the query's own ----
  if (view) {
    problems.push(...checkEntries(listed, view.card, ctx.path, model));
    problems.push(...await checkViewSampleData(view, ctx.discoveryMap));
  }
  if (card) problems.push(...checkEntries(listed, card, ctx.path, model));
  return { name: q.name, entries: listed, ...(view ? { view } : {}), problems: [...new Set(problems)], notes: [...new Set(notes)] };
}
