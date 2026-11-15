// Categories: what a page is about, independent of the folder it is in, so a page changes category without changing
// its URL. The config declares them (storefront.categories: key, label, optional description, and old keys kept after
// a rename); a page names them in its reserved `categories:` (listing-keys.ts readCategories). A layout gets them as
// page.categories, a listing entry carries them, and site.categories is every declared one, in the config's order,
// when partials/base lists `categories` under site (no shape of its own: a category's shape is Pattern Dump's).

import type { StorefrontCategory } from "@pattern-dump/config";

export const CATEGORIES_KEY = "categories";

/** A category as layouts get it. */
export interface Category { key: string; label: string; description: string | null }

/** The declared categories, ready to resolve a page's values against. */
export interface CategoryIndex {
  /** In the config's order. */
  list: Category[];
  byKey: ReadonlyMap<string, Category>;
  /** Old key → the key it is now. */
  aliases: ReadonlyMap<string, string>;
}

/** storefront.categories (already checked by the config's validation), indexed. */
export function categoryIndex(declared: Readonly<Record<string, StorefrontCategory>> | undefined): CategoryIndex {
  const list: Category[] = [];
  const aliases = new Map<string, string>();
  for (const [key, c] of Object.entries(declared ?? {})) {
    list.push({ key, label: c.label, description: c.description ?? null });
    for (const a of c.aliases ?? []) aliases.set(a, key);
  }
  return { list, byKey: new Map(list.map(c => [c.key, c])), aliases };
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Whether partials/base lists site.categories (`declared`, its schema there), and what is wrong with it: a shape of
 * the skin's, or a config that sets site.categories itself.
 */
export function checkSiteCategories(declared: unknown, owner: string, configured: Obj | undefined): { listed: boolean; problems: string[] } {
  const problems: string[] = [];
  if (configured && Object.hasOwn(configured, CATEGORIES_KEY)) {
    problems.push(`storefront.site.${CATEGORIES_KEY} is filled by Pattern Dump from storefront.categories: list it in ${owner}'s schema, and don't set it in storefront.site`);
  }
  if (declared === undefined) return { listed: false, problems };
  const own = Object.keys(isObject(declared) ? declared : {}).filter(k => k !== "description" && k !== "title");
  if (own.length) {
    problems.push(`${owner} declares ${own.map(k => `"${k}"`).join(", ")} for site.${CATEGORIES_KEY}: the shape of a category is Pattern Dump's, so list the name only (a description at most)`);
  }
  return { listed: true, problems };
}
