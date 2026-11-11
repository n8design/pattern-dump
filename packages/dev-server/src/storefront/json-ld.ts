// A storefront page's structured data: one JSON-LD graph, derived from what the site already has — the
// site (WebSite), the page (WebPage, with its last change from git) and where it sits (a BreadcrumbList from
// the folders, ending at the page). Richer types (Article, FAQ, …) are not core's; a plugin adds a node to
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
  /** The page's last change, ISO 8601, or null when git has no reliable date for it. */
  modified: string | null;
}

/** The page's JSON-LD as a <script> element. Every "<" in it is written <, so no value can end the
 *  element ("</script>") or open a comment. */
export function jsonLdScript(p: JsonLdPage): string {
  const abs = (route: string) => new URL(route.replace(/^\//, ""), p.siteUrl).href;
  const site = `${p.siteUrl}#website`;
  const trail = [...p.breadcrumbs, { route: p.route, title: p.title }];
  const graph = [
    { "@type": "WebSite", "@id": site, url: p.siteUrl, ...(p.siteTitle ? { name: p.siteTitle } : {}) },
    {
      "@type": "WebPage", "@id": abs(p.route), url: abs(p.route), name: p.title,
      ...(p.description ? { description: p.description } : {}),
      isPartOf: { "@id": site },
      ...(p.modified ? { dateModified: p.modified } : {}),
      ...(p.breadcrumbs.length ? {
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: trail.map((l, i) => ({ "@type": "ListItem", position: i + 1, name: l.title, item: abs(l.route) })),
        },
      } : {}),
    },
  ];
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
