// Listing views: how a listing is shown. A view is a component directly under views/ in the skin's style guide
// (`views/grid`), as a layout is under layouts/; Pattern Dump has none of its own, so every skin defines its own.
//
//   - A folder's index.md names its view: `view: grid`. A layout that shows a listing declares `page.listing` and
//     writes `{{{page.listing}}}`: the folder's pages rendered through the view, once, with `entries` (the pages, in
//     the folder's sort order) as the view's only data.
//   - A view's schema declares `entries`, a list, with `x-pd-card` naming the card it shows each page as. That card's
//     `required` are the fields the view needs (cards.ts): separate cards per view, not variants of one, so each
//     view's fields are checked on their own.
//   - Checked: a view that isn't one, a listing page that names none, a view on a page whose layout shows no listing,
//     a view that names no card. Its sample data, and its card's, may hold only the fields of a page in a listing.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { suggest } from "@pattern-dump/config";
import { readSchema } from "./declared-values.js";
import { cardOf, readCard, type Card } from "./cards.js";
import { ENTRY, outsideShape } from "./derived.js";

const VIEW_ID = /^views\/[^/~]+$/;
/** The data a view is rendered with: the pages of its listing. */
export const VIEW_KEY = "entries";

/** The views a listing can name: base components directly under views/. */
export function viewNames(discoveryMap: DiscoveryMap): string[] {
  return [...discoveryMap.keys()].filter(id => VIEW_ID.test(id)).map(id => id.slice("views/".length)).sort();
}

/** A view, resolved for a listing page: its component and its card. */
export interface ResolvedView { id: string; card: Card }

/**
 * The view `name`, named at `at` ("articles/index.md:4", or a layout), read for a listing: its component and its card,
 * or every problem with it.
 */
export async function viewOf(name: string, at: string, discoveryMap: DiscoveryMap): Promise<{ view?: ResolvedView; problems: string[] }> {
  const names = viewNames(discoveryMap);
  const list = names.length ? `the views are ${names.map(n => `"${n}"`).join(", ")}` : undefined;
  const id = `views/${name}`;
  if (!VIEW_ID.test(id) || !discoveryMap.has(id)) {
    if (!list) return { problems: [`${at}: view "${name}" is not a view: the skin has no views (components in a views/ folder of its patterns)`] };
    const near = suggest(name, names);
    return { problems: [`${at}: view "${name}" is not a view: ${near ? `did you mean "${near}"? (${list})` : list}`] };
  }
  const read = await readSchema(discoveryMap.get(id)?.schemaPath);
  if (read.error !== undefined) return { problems: [`${id}: its schema cannot be read: ${read.error}`] };
  const cardId = cardOf(read.schema?.properties?.[VIEW_KEY]);
  if (cardId === undefined) {
    return { problems: [`${id}: its schema declares no "${VIEW_KEY}" list with "x-pd-card": a view names the card it shows each page as, `
      + `so each page can be checked against it`] };
  }
  const card = await readCard(cardId, id, `the card of view "${name}"`, discoveryMap);
  return card.card ? { view: { id, card: card.card }, problems: card.problems } : { problems: card.problems };
}

/** The key on a layout's page.listing that names the view its listings are shown in when the index.md names none. */
export const DEFAULT_VIEW_KEY = "x-pd-view";

/**
 * The view a listing page names (`view`, at `line`), else its layout's default (`fallback`, x-pd-view on page.listing),
 * for a layout that shows a listing or not (`shows`). Every problem, each with the page's file, or the layout's id for
 * its default. Nothing to do for a page that names none and shows none.
 */
export async function resolveView(o: {
  view: string | undefined; line: number | undefined; path: string; layout: string; shows: boolean; discoveryMap: DiscoveryMap;
  fallback?: string | undefined;
}): Promise<{ view?: ResolvedView; problems: string[] }> {
  const at = `${o.path}${o.line !== undefined ? `:${o.line}` : ""}`;
  const names = viewNames(o.discoveryMap);
  const list = names.length ? `the views are ${names.map(n => `"${n}"`).join(", ")}` : undefined;
  if (o.view === undefined) {
    if (!o.shows) return { problems: [] };
    if (o.fallback !== undefined) return viewOf(o.fallback, `layouts/${o.layout} (${DEFAULT_VIEW_KEY} on page.listing)`, o.discoveryMap);
    return { problems: [`${o.path}: layout "${o.layout}" shows a listing (page.listing), so name its view: view: <name> `
      + `(${list ?? "the skin has no views yet: components in a views/ folder of its patterns"}), or give the layout a default `
      + `("${DEFAULT_VIEW_KEY}" on page.listing)`] };
  }
  if (!o.shows) return { problems: [`${at}: view names how a listing is shown, but layout "${o.layout}" shows none (it doesn't declare page.listing)`] };
  return viewOf(o.view, at, o.discoveryMap);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A view's sample data, and its card's: the view may set only `entries`, each a page of a listing, and the card only
 * the fields of one. The renderer merges a component's sample data beneath what it is given, so anything else would
 * show on every listing shown in the view.
 */
export async function checkViewSampleData(view: ResolvedView, discoveryMap: DiscoveryMap): Promise<string[]> {
  const problems: string[] = [];
  const read = async (id: string): Promise<{ data?: unknown; where: string } | undefined> => {
    const jsonPath = discoveryMap.get(id)?.jsonPath;
    if (!jsonPath) return undefined;
    const where = `the sample data of ${id} (${basename(jsonPath)})`;
    try { return { data: JSON.parse(await readFile(jsonPath, "utf8")) as unknown, where }; }
    catch (e) { problems.push(`${where} cannot be read: ${e instanceof Error ? e.message : String(e)}`); return undefined; }
  };
  const own = await read(view.id);
  if (own && isPlainObject(own.data)) {
    for (const key of Object.keys(own.data).filter(k => k !== VIEW_KEY)) {
      problems.push(`${own.where} sets "${key}", which a view doesn't get: a view gets only ${VIEW_KEY}, the pages of its listing`);
    }
    for (const at of outsideShape(own.data[VIEW_KEY], { items: ENTRY }, VIEW_KEY)) {
      problems.push(`${own.where} sets "${at}", which is not a field of a page in a listing, so it would show on every page using ${view.id}`);
    }
  }
  const card = await read(view.card.id);
  if (card) {
    for (const at of outsideShape(card.data, ENTRY, "")) {
      problems.push(`${card.where} sets "${at.slice(1)}", which is not a field of a page in a listing, so it would show on every card of ${view.id}`);
    }
  }
  return problems;
}
