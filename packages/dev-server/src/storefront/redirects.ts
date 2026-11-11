// A page's old routes (frontmatter `redirectFrom`): each forwards to the page. On a static host a redirect is
// a page of its own at the old route, so that is what both pd dev and pd build answer there: a page that
// forwards at once (meta refresh, which search engines take as a permanent redirect), names its target as
// canonical, is never indexed, and links to the target for a reader whose browser does not forward.

import { PD_ROUTE_PREFIX } from "@pattern-dump/contracts";
import { escapeAttr, escapeHtml } from "../http-utils.js";
import type { PageFile } from "./pages.js";

/** The old routes a page file lists, as written (the shape is checked with the page's frontmatter). */
export function redirectsOf(f: PageFile): string[] {
  const v = f.frontmatter.values["redirectFrom"];
  return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
}

/** Old routes that can't be one: those the server answers itself. */
const RESERVED = [PD_ROUTE_PREFIX.preview, "/_pd/", PD_ROUTE_PREFIX.assets, "/api/", PD_ROUTE_PREFIX.source];

/**
 * The problems of the site's redirects as a whole, one line each with the file and line it is set on: an old
 * route that is a page, one two pages both claim, one the server answers itself. (A chain can't arise: every
 * target is a page, and no old route may be one.)
 */
export function redirectProblems(files: ReadonlyMap<string, PageFile>): string[] {
  const problems: string[] = [];
  const claimed = new Map<string, PageFile>();
  for (const f of files.values()) {
    const at = `${f.path}${f.frontmatter.lines["redirectFrom"] !== undefined ? `:${f.frontmatter.lines["redirectFrom"]}` : ""}`;
    for (const old of redirectsOf(f)) {
      if (typeof old !== "string" || !old.startsWith("/") || !old.endsWith("/")) continue; // a shape problem of the page's own
      const page = files.get(old);
      if (page) { problems.push(`${at}: redirectFrom "${old}" is the page ${page.path}: a route can't both be a page and forward to one`); continue; }
      const reserved = RESERVED.find(r => old.startsWith(r));
      if (reserved) { problems.push(`${at}: redirectFrom "${old}" is under ${reserved}, which Pattern Dump serves itself`); continue; }
      const other = claimed.get(old);
      if (other && other !== f) { problems.push(`${at}: redirectFrom "${old}" is also claimed by ${other.path}: one old route forwards to one page`); continue; }
      claimed.set(old, f);
    }
  }
  return problems;
}

/** The page at an old route: forwards to `route` at once. */
export function redirectStub(p: { route: string; title: string; siteUrl: string | undefined; lang: string }): string {
  const target = escapeAttr(p.route);
  const canonical = p.siteUrl !== undefined ? `\n<link rel="canonical" href="${escapeAttr(new URL(p.route.slice(1), p.siteUrl).href)}">` : "";
  return `<!DOCTYPE html>
<html lang="${escapeAttr(p.lang)}">
<head>
<meta charset="UTF-8">
<title>Moved to ${escapeHtml(p.title)}</title>${canonical}
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${target}">
</head>
<body>
<p>This page has moved to <a href="${target}">${escapeHtml(p.title)}</a>.</p>
</body>
</html>
`;
}
