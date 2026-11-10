// What the storefront derives for a page, passed to its layout as `page`.
//
// The shape is Pattern Dump's, fixed, and owned here: a skin never declares it, it only opts in. A layout
// that declares `page` in its schema, with sub-properties, gets exactly the sub-keys it declares, each
// present and null where nothing is derived; a layout that does not declare `page` gets none. A declared
// sub-key Pattern Dump does not fill is a problem that names the ones it does.
//
// The same shape bounds the sample data (sample-data.ts): the renderer merges a layout's sample data
// beneath a page's values key by key, so a sample key outside this shape, at any depth, would show on
// every page using the layout.

import type { StorefrontNavItem, StorefrontPagesResponse } from "@pattern-dump/contracts";

/** A link to another page. */
export interface PageLink { route: string; title: string }
/** A heading in the page's markdown, with the id it carries. */
export interface PageHeading { level: number; text: string; anchor: string }

/** Everything Pattern Dump can derive for a page. */
export interface DerivedPage {
  headings: PageHeading[];
  section: PageLink | null;
  breadcrumbs: PageLink[];
  prev: PageLink | null;
  next: PageLink | null;
  created: string | null;
  modified: string | null;
}

/** A value with no keys of its own; an object with exactly these fields; a list of one shape. */
export type Shape = "value" | { fields: Record<string, Shape> } | { items: Shape };

const LINK: Shape = { fields: { route: "value", title: "value" } };

/** The shape of `page`, field by field. */
export const PAGE_SHAPE: { fields: Record<keyof DerivedPage, Shape> } = {
  fields: {
    headings: { items: { fields: { level: "value", text: "value", anchor: "value" } } },
    section: LINK,
    breadcrumbs: { items: LINK },
    prev: LINK,
    next: LINK,
    created: "value",
    modified: "value",
  },
};

/** The sub-keys of `page` Pattern Dump fills today. Each later step adds the keys it derives. */
export const FILLED: readonly (keyof DerivedPage)[] = ["headings", "section", "breadcrumbs", "prev", "next"];

/** A page's place in the site. */
export type Position = Pick<DerivedPage, "section" | "breadcrumbs" | "prev" | "next">;

/**
 * Where `route` sits, from the pages and the nav alone (the inputs the watcher's pages fingerprint covers,
 * so a change to any of them reloads every page):
 *  - `section`: the top-level nav entry the page falls under (a folder's entry is its index.md), by the
 *    page's first path segment; a top-level page is its own section. Null when no entry holds it.
 *  - `breadcrumbs`: Home, then each folder above the page, by its index.md, down to its parent; the
 *    page itself is not one. Empty for the home page. From the folders, so it reaches pages the nav
 *    does not (the nav is one level deep).
 *  - `prev` and `next`: the neighbours in the nav read depth first (an entry, then its children), across
 *    sections. Null at either end, and for a page the nav does not list.
 */
export function positionOf(route: string, site: Pick<StorefrontPagesResponse, "pages" | "nav">): Position {
  const titles = new Map(site.pages.map(p => [p.route, p.title]));
  const link = (r: string): PageLink | null => titles.has(r) ? { route: r, title: titles.get(r)! } : null;

  const segments = route.split("/").filter(Boolean);
  const breadcrumbs = segments
    .map((_, i) => link(i === 0 ? "/" : `/${segments.slice(0, i).join("/")}/`))
    .filter((l): l is PageLink => l !== null);

  const top = segments.length ? `/${segments[0]}/` : "/";
  const entry = site.nav.find(n => n.route === top) ?? null;

  const flat: StorefrontNavItem[] = site.nav.flatMap(n => [n, ...(n.children ?? [])]);
  const at = flat.findIndex(n => n.route === route);
  const linkOf = (n: StorefrontNavItem | undefined): PageLink | null => n ? { route: n.route, title: n.title } : null;
  return {
    section: entry ? { route: entry.route, title: entry.title } : null,
    breadcrumbs,
    prev: at > 0 ? linkOf(flat[at - 1]) : null,
    next: at >= 0 ? linkOf(flat[at + 1]) : null,
  };
}

type Prop = Record<string, unknown>;
const isObject = (v: unknown): v is Prop => typeof v === "object" && v !== null && !Array.isArray(v);

export interface PageDeclaration {
  /** The sub-keys of `page` the layout declares; undefined when it does not declare `page`. */
  declared: string[] | undefined;
  problems: string[];
}

/** What `layoutId`'s schema declares for `page`, and every declared sub-key Pattern Dump does not fill. */
export function checkPageDeclaration(schema: unknown, layoutId: string, filled: readonly string[] = FILLED): PageDeclaration {
  const props = isObject(schema) && isObject(schema["properties"]) ? schema["properties"] : {};
  const page = Object.hasOwn(props, "page") ? props["page"] : undefined;
  if (page === undefined) return { declared: undefined, problems: [] };
  const declared = isObject(page) && isObject(page["properties"]) ? Object.keys(page["properties"]) : [];
  const fills = filled.length ? `it fills ${filled.map(k => `page.${k}`).join(", ")}` : "it fills none yet";
  const problems = declared
    .filter(key => !filled.includes(key))
    .map(key => `${layoutId} declares "page.${key}", which Pattern Dump does not fill (${fills})`);
  return { declared, problems };
}

/** The `page` a layout gets: each declared sub-key, with its derived value or null. */
export function pageValue(declared: readonly string[], derived: Partial<DerivedPage>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of declared) out[key] = Object.hasOwn(derived, key) ? derived[key as keyof DerivedPage] ?? null : null;
  return out;
}

/** Every key path in `value` outside `shape`, at any depth (`page.prev.extra`, `page.headings[0].x`). */
export function outsideShape(value: unknown, shape: Shape, path: string): string[] {
  if (Array.isArray(value)) {
    // A list where a list is declared holds items of its shape; anywhere else its items hold plain values.
    const item = typeof shape === "object" && "items" in shape ? shape.items : "value";
    return value.flatMap((v, i) => outsideShape(v, item, `${path}[${i}]`));
  }
  if (!isObject(value)) return [];
  const fields = typeof shape === "object" && "fields" in shape ? shape.fields : {};
  return Object.entries(value).flatMap(([key, v]) =>
    Object.hasOwn(fields, key) ? outsideShape(v, fields[key]!, `${path}.${key}`) : [`${path}.${key}`]);
}
