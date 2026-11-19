// Tag and category pages: a page per term (tag or category) with at least one published page, and an index of them,
// generated from the pages, never written as files.
//
//   /tags/css/          a tag's page, through the skin's layouts/tag; its title is the tag's label
//   /tags/              every tag with a page, through layouts/tags
//   /categories/...     the same for categories, through layouts/category and layouts/categories
//
// - On and off (storefront.tagPages, storefront.categoryPages): left out, on when the skin has the term's layout (the
//   index when it has that layout too), no layout no pages and no message; false, off; true or { path, title }, on,
//   and a missing layout is a problem. `path` is the URL segment (default tags, categories), `title` the index's.
// - Published pages only: a draft or a scheduled page counts for no term, in pd dev too, so a term only they have
//   gets no page.
// - An old key (alias) of a declared term with a page forwards to it: /tags/<old>/ is a redirect, through the page's
//   redirectFrom, so the stub and its checks are every redirect's.
// - The pages folder can't have a page at a generated route, and no page's redirectFrom may claim one.
//
// A term page lists its pages through a query its layout declares, with `tags: same` (`categories: same`): the page's
// own terms, which for a term page is its term (query.ts).

import type { StorefrontTermPages } from "@pattern-dump/config";
import type { TermIndex, TermKind } from "./categories.js";
import type { TermPage } from "./derived.js";

/** A generated page: a term's, or the index of a kind. */
export interface GeneratedPage {
  route: string;
  kind: TermKind;
  role: "term" | "index";
  /** The layout's name: tag, tags, category, categories. */
  layout: string;
  title: string;
  description: string | null;
  /** A term page's term; the index's every term with a page, by label. */
  term?: TermPage;
  terms?: TermPage[];
  /** The old routes that forward here: an alias's. */
  redirectFrom: string[];
  /** The newest `updated` (else `date`) of its pages, for the sitemap; null when none has one. */
  lastmod: string | null;
}

/** What a term page shows of a published page: its route, its terms' keys and its dates. */
export interface TermSource { route: string; path: string; tags: string[]; categories: string[]; date: string | null; updated: string | null; redirectFrom: string[] }

const KINDS: Readonly<Record<TermKind, { term: string; index: string; path: string; title: string; config: string; many: string }>> = {
  tag: { term: "tag", index: "tags", path: "tags", title: "Tags", config: "site.tagPages", many: "tags" },
  category: { term: "category", index: "categories", path: "categories", title: "Categories", config: "site.categoryPages", many: "categories" },
};

export interface TermPagesInput {
  indexes: Readonly<Record<TermKind, TermIndex>>;
  settings: Readonly<Record<TermKind, boolean | StorefrontTermPages | undefined>>;
  /** The skin's layouts, by name. Without it (nothing knows the skin yet) no page is generated. */
  layouts: ReadonlySet<string> | undefined;
  /** Every published page (not a draft, not scheduled). */
  sources: readonly TermSource[];
  /** Every page of the pages folder, by route, with its path, and every route a page claims as an old one. */
  files: ReadonlyMap<string, { path: string }>;
}

/** The generated pages, by route (each kind's index first, then its terms by key), and every problem with them. */
export function termPages(input: TermPagesInput): { pages: GeneratedPage[]; problems: string[] } {
  const pages: GeneratedPage[] = [];
  const problems: string[] = [];
  if (!input.layouts) return { pages, problems };
  const collator = new Intl.Collator("en", { sensitivity: "base" });
  const newest = (xs: readonly TermSource[]): string | null =>
    xs.map(x => x.updated ?? x.date).filter((d): d is string => d !== null).sort().at(-1) ?? null;
  const claimed = new Map<string, string>();
  for (const s of input.sources) for (const old of s.redirectFrom) claimed.set(old, s.path);

  for (const kind of ["tag", "category"] as const) {
    const k = KINDS[kind];
    const setting = input.settings[kind];
    if (setting === false) continue;
    const asked = setting === true || typeof setting === "object";
    const o = typeof setting === "object" ? setting : {};
    const hasTerm = input.layouts.has(k.term), hasIndex = input.layouts.has(k.index);
    if (asked) {
      for (const [has, layout, what] of [[hasTerm, k.term, `the page of each ${k.term}`], [hasIndex, k.index, `the index of the ${k.many}`]] as const) {
        if (!has) problems.push(`${k.config} asks for ${k.term} pages, but the skin has no layout "${layout}" (${what}): add layouts/${layout}, or mark a page or template pattern with "x-pd-layout": "${layout}", or set ${k.config.split(".")[1]} to false`);
      }
    }
    if (!hasTerm) continue;
    const path = o.path ?? k.path;
    const index = input.indexes[kind];
    const byKey = new Map<string, TermSource[]>();
    for (const s of input.sources) for (const key of kind === "tag" ? s.tags : s.categories) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(s);
    }
    const terms: TermPage[] = [];
    const own: GeneratedPage[] = [];
    for (const key of [...byKey.keys()].sort()) {
      const t = index.byKey.get(key);
      const term: TermPage = { key, label: t?.label ?? key, description: t?.description ?? null, route: `/${path}/${key}/`, count: byKey.get(key)!.length };
      terms.push(term);
      const olds = [...index.aliases].filter(([, to]) => to === key).map(([from]) => `/${path}/${from}/`);
      own.push({ route: term.route, kind, role: "term", layout: k.term, title: term.label, description: term.description, term,
        redirectFrom: olds, lastmod: newest(byKey.get(key)!) });
    }
    terms.sort((a, b) => collator.compare(a.label, b.label) || (a.key < b.key ? -1 : 1));
    if (hasIndex && terms.length) {
      pages.push({ route: `/${path}/`, kind, role: "index", layout: k.index, title: o.title ?? k.title, description: null, terms,
        redirectFrom: [], lastmod: newest(input.sources.filter(s => (kind === "tag" ? s.tags : s.categories).length > 0)) });
    }
    pages.push(...own);

    // A route the pages folder has, or a page claims as an old one.
    const fix = `give the ${k.term} pages another path (${k.config}: { path: "..." })`;
    for (const g of pages.filter(p => p.kind === kind)) {
      const what = g.role === "index" ? `the index of the ${k.many}` : `the page of the ${k.term} "${g.term!.key}"`;
      for (const route of [g.route, ...g.redirectFrom]) {
        const forwards = route !== g.route ? ` (an old key's route, which forwards to ${g.route})` : "";
        const file = input.files.get(route);
        if (file) {
          const top = file.path.includes("/") ? `${file.path.split("/")[0]}/` : file.path;
          problems.push(`${file.path} is the page at ${route}, which is ${what} as well${forwards}: rename ${top}, or ${fix}`);
        }
        const by = claimed.get(route);
        if (by) problems.push(`${by}: redirectFrom "${route}" is ${what}${forwards}: a route can't both be a page and forward to one`);
      }
    }
  }
  return { pages, problems };
}
