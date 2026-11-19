// Tags and categories, "terms": what a page is about, independent of the folder it is in, so a page changes category
// without changing its URL.
//
//   - Categories are declared in the config (storefront.categories: key, label, optional description, and old keys
//     kept after a rename); a page names them in its reserved `categories:`.
//   - Tags may be declared the same way (storefront.tags). Without declarations every tag works, labelled with its
//     key; with them, they are the list, as categories are.
//
// A layout gets a page's terms as page.tags and page.categories, `{ key, label, description, route }`, route the
// term's generated page (terms.ts) or null; a listing entry carries them, and site.categories is every declared
// category, in the config's order, when partials/base lists `categories` under site (no shape of its own).

import type { StorefrontCategory } from "@pattern-dump/config";

export const CATEGORIES_KEY = "categories";

/** A kind of term. */
export type TermKind = "tag" | "category";

/** A tag or a category as layouts get it. */
export interface Term { key: string; label: string; description: string | null; route: string | null }
/** A category as layouts get it. */
export type Category = Term;

/** The declared terms of one kind, ready to resolve a page's values against. */
export interface TermIndex {
  kind: TermKind;
  /** Whether the config declares them (storefront.tags may be left out: then any tag is one, labelled with its key). */
  declared: boolean;
  /** In the config's order. Their route is set once the generated pages are known (pages.ts). */
  list: Term[];
  byKey: ReadonlyMap<string, Term>;
  /** Old key → the key it is now. */
  aliases: ReadonlyMap<string, string>;
}
export type CategoryIndex = TermIndex;

/** How messages name a kind. */
export const TERM_WORDS: Readonly<Record<TermKind, { one: string; many: string; config: string }>> = {
  tag: { one: "tag", many: "tags", config: "site.tags" },
  category: { one: "category", many: "categories", config: "site.categories" },
};

/** storefront.tags or storefront.categories (already checked by the config's validation), indexed. */
export function termIndex(kind: TermKind, declared: Readonly<Record<string, StorefrontCategory>> | undefined): TermIndex {
  const list: Term[] = [];
  const aliases = new Map<string, string>();
  for (const [key, c] of Object.entries(declared ?? {})) {
    list.push({ key, label: c.label, description: c.description ?? null, route: null });
    for (const a of c.aliases ?? []) aliases.set(a, key);
  }
  // Categories are always the declared list (none declared: no page may name one); tags only when declared.
  return { kind, declared: kind === "category" || declared !== undefined, list, byKey: new Map(list.map(c => [c.key, c])), aliases };
}

/** storefront.categories, indexed. */
export const categoryIndex = (declared: Readonly<Record<string, StorefrontCategory>> | undefined): CategoryIndex => termIndex("category", declared);

/** The term `key` of `index` as layouts get it: the declared one, or (undeclared tags) labelled with its key. */
export function termOf(index: TermIndex, key: string): Term {
  return index.byKey.get(key) ?? { key, label: key, description: null, route: null };
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
    problems.push(`site.globals.${CATEGORIES_KEY} is filled by Pattern Dump from site.categories: list it in ${owner}'s schema, and don't set it in site.globals`);
  }
  if (declared === undefined) return { listed: false, problems };
  const own = Object.keys(isObject(declared) ? declared : {}).filter(k => k !== "description" && k !== "title");
  if (own.length) {
    problems.push(`${owner} declares ${own.map(k => `"${k}"`).join(", ")} for site.${CATEGORIES_KEY}: the shape of a category is Pattern Dump's, so list the name only (a description at most)`);
  }
  return { listed: true, problems };
}
