// A storefront page's structured data: one JSON-LD graph, derived from what the site already has — the
// site (WebSite), the page (WebPage, with its date and its authored last change) and where it sits (a BreadcrumbList from
// the folders, ending at the page). A page that is an article (page.ts articleOf, the same pages og:type calls one)
// adds an Article node, the page's main entity. Richer types (FAQ, …) are not core's; a plugin adds a node to
// the same @graph.

import type { PageLink } from "./derived.js";

export interface JsonLdPage {
  /** The site's address, ending with "/". */
  siteUrl: string;
  siteTitle: string | undefined;
  route: string;
  title: string;
  description: string | undefined;
  /** The folders above the page, Home first (derived.ts positionOf); the page itself is added last. */
  breadcrumbs: PageLink[];
  /** The page's last real change: its own `updated` (YYYY-MM-DD), or null. Never git's last commit. */
  modified: string | null;
  /** The page's date: its own (frontmatter `date`, YYYY-MM-DD), else git's first commit of it (ISO 8601), or null. */
  published?: string | null;
  /** The page is an article: its own date, its tags' and its categories' labels (page.ts articleOf). */
  article?: { published: string; tags: string[]; sections: string[] } | undefined;
  /** A generated tag or category page, or an index of them (terms.ts): a CollectionPage, not a WebPage. */
  collection?: boolean;
}

/** The page's JSON-LD as a <script> element. Every "<" in it is written as the JSON escape \u003c, so no value can
 *  end the element ("</script>") or open a comment. */
export function jsonLdScript(p: JsonLdPage): string {
  const abs = (route: string) => new URL(route.replace(/^\//, ""), p.siteUrl).href;
  const site = `${p.siteUrl}#website`;
  const trail = [...p.breadcrumbs, { route: p.route, title: p.title }];
  const graph: Record<string, unknown>[] = [
    { "@type": "WebSite", "@id": site, url: p.siteUrl, ...(p.siteTitle ? { name: p.siteTitle } : {}) },
    {
      "@type": p.collection ? "CollectionPage" : "WebPage", "@id": abs(p.route), url: abs(p.route), name: p.title,
      ...(p.description ? { description: p.description } : {}),
      isPartOf: { "@id": site },
      ...(p.published ? { datePublished: p.published } : {}),
      ...(p.modified ? { dateModified: p.modified } : {}),
      ...(p.breadcrumbs.length ? {
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: trail.map((l, i) => ({ "@type": "ListItem", position: i + 1, name: l.title, item: abs(l.route) })),
        },
      } : {}),
    },
  ];
  if (p.article) {
    graph.push({
      "@type": "Article", "@id": `${abs(p.route)}#article`, headline: p.title,
      ...(p.description ? { description: p.description } : {}),
      mainEntityOfPage: { "@id": abs(p.route) }, isPartOf: { "@id": site },
      datePublished: p.article.published,
      ...(p.modified ? { dateModified: p.modified } : {}),
      ...(p.article.tags.length ? { keywords: p.article.tags } : {}),
      ...(p.article.sections.length ? { articleSection: p.article.sections.length === 1 ? p.article.sections[0] : p.article.sections } : {}),
    });
  }
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
