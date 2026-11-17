// A listing's card: the component each page of a listing is shown as, named by `x-pd-card` on a list property (a
// layout's `page.children`, a view's `entries`). Every page in the listing is checked against the card's schema:
//
//   - a field the card `required`s that a page doesn't have (null, or an empty list) fails the listing page, once
//     per page and field, naming the page and what to add;
//   - a value the page has is checked against the type the card declares;
//   - a card may declare only the fields of a listing's entry (ENTRY, derived.ts). That shape is Pattern Dump's and
//     the base every card shares: a page can't add fields to it, so a card says which of them it shows, and which it
//     needs with `required`.
//
// The renderer checks the reference itself in the workbench (schema-extensions.ts); a page checks it again, since a
// listing can't be checked against a card that isn't there.

import type { DiscoveryMap } from "@pattern-dump/contracts";
import { checkDeclared, readSchema, type ObjectSchema, type PropertySchema } from "./declared-values.js";
import { ENTRY } from "./derived.js";
import type { Entry } from "./collections.js";
import type { PageModel } from "./pages.js";
import { designFiles } from "./design-files.js";

export const CARD_KEY = "x-pd-card";
/** The fields of a page in a listing, in the entry's order. */
export const ENTRY_FIELDS: readonly string[] = Object.keys((ENTRY as { fields: Record<string, unknown> }).fields);

/** The card a list property names, when it names one. */
export function cardOf(prop: unknown): string | undefined {
  if (typeof prop !== "object" || prop === null) return undefined;
  const card = (prop as Record<string, unknown>)[CARD_KEY];
  return typeof card === "string" ? card : undefined;
}

/** A card, read for checking a listing: its schema, and how messages name it. */
export interface Card {
  id: string;
  schema: ObjectSchema;
  /** "the listing's card (components/card)", or "the card of view "grid" (components/grid-card)". */
  label: string;
}

/**
 * The card `id`, named by `owner` (the layout or view whose schema names it), read for a listing: its schema, and
 * every problem with it (no such component, no schema, a field no page in a listing has). `role`: how messages name
 * the card ("the listing's card", `the card of view "grid"`).
 */
export async function readCard(id: string, owner: string, role: string, discoveryMap: DiscoveryMap): Promise<{ card?: Card; problems: string[] }> {
  const entry = discoveryMap.get(id);
  if (!entry) return { problems: [`${owner}: ${CARD_KEY} names "${id}", which is not a component`] };
  const read = await readSchema(entry.schemaPath, designFiles(discoveryMap));
  if (read.error !== undefined) return { problems: [`${owner}: the schema of its card ${id} cannot be read: ${read.error}`] };
  if (!read.schema) return { problems: [`${owner}: ${CARD_KEY} names "${id}", which has no schema, so a listing's pages can't be checked against it`] };
  const declared = [...Object.keys(read.schema.properties ?? {}), ...(read.schema.required ?? [])];
  const outside = [...new Set(declared.filter(k => !ENTRY_FIELDS.includes(k)))];
  const problems = outside.map(k => `${id} (${role}, ${owner}) declares "${k}", which a page in a listing doesn't have: `
    + `a card declares only the fields Pattern Dump fills (${ENTRY_FIELDS.join(", ")})`);
  // Tags were strings before 0.5.0: a card still declaring them so would fail every page with a type mismatch.
  const tagItems = (read.schema.properties?.["tags"] as { items?: { type?: unknown } } | undefined)?.items?.type;
  if (tagItems === "string" || (Array.isArray(tagItems) && tagItems.includes("string") && !tagItems.includes("object"))) {
    problems.push(`${id} (${role}, ${owner}) declares tags as a list of strings, but a tag is an object since 0.5.0 `
      + `(key, label, description, route): declare its items as "type": "object", or leave items out`);
  }
  return problems.length ? { problems } : { card: { id, schema: read.schema, label: `${role} (${id})` }, problems };
}

/** What to write to give a page the field, for the message. */
const HINTS: Readonly<Record<string, string>> = {
  image: "image: /assets/images/<name>.jpg, a raster image in the assets",
  date: "date: YYYY-MM-DD",
  updated: "updated: YYYY-MM-DD",
  description: "description: one sentence, or a first paragraph in its body",
  tags: "tags: [a-tag]",
  categories: "categories: [a-category], declared in storefront.categories",
};

const missing = (v: unknown): boolean => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/** Every page of a listing against its card: `index`, the listing page's path in the pages folder. */
export function checkEntries(entries: readonly Entry[], card: Card, index: string, model: PageModel): string[] {
  const problems: string[] = [];
  const props: Record<string, PropertySchema> = card.schema.properties ?? {};
  for (const e of entries) {
    const file = model.files.get(e.route)?.path ?? e.route;
    const values = e as unknown as Record<string, unknown>;
    for (const key of card.schema.required ?? []) {
      if (!missing(values[key])) continue;
      const hint = HINTS[key];
      problems.push(`${index}: ${file} has no ${key}, which ${card.label} requires: give it one${hint ? ` (${hint})` : ""}`);
    }
    for (const [key, prop] of Object.entries(props)) {
      const v = values[key];
      if (missing(v)) continue; // no value: only `required` is about that
      const r = checkDeclared(prop, v, "json");
      if (!r.ok) problems.push(`${index}: ${file}: ${key} ${r.message} for ${card.label}`);
    }
  }
  return problems;
}
