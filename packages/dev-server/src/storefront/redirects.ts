// A page's old routes (frontmatter `redirectFrom`): each forwards to the page. On a static host a redirect is
// a page of its own at the old route, so that is what both pd dev and pd build answer there: a page that
// forwards at once (meta refresh, which search engines take as a permanent redirect), names its target as
// canonical, is never indexed, and links to the target for a reader whose browser does not forward.

import { PD_ROUTE_PREFIX, PD_ROUTES } from "@pattern-dump/contracts";
import { escapeAttr, escapeHtml } from "../http-utils.js";
import type { PageFile } from "./pages.js";

/** The old routes a page file lists, as written (the shape is checked with the page's frontmatter). */
export function redirectsOf(f: PageFile): string[] {
  const v = f.frontmatter.values["redirectFrom"];
  return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
}

/** Old routes that can't be one: those the server answers itself. */
const RESERVED = [PD_ROUTE_PREFIX.preview, "/_pd/", PD_ROUTE_PREFIX.assets, "/api/", PD_ROUTE_PREFIX.source];

/** An old route that is a file (/old/page.html), not a folder: the forwarding page is written at that path itself. */
export const isFileRoute = (route: string): boolean => /\/[^/]+\.html$/.test(route);

/**
 * The problems of the site's redirects as a whole, one line each with the file and line it is set on: an old
 * route that is a page, one two pages both claim, one the server answers itself, one at or under the path of a
 * workbench published on the same host (`workbenchPath`, from sameHostWorkbenchPath), and a file that is a page's
 * own (/guide/index.html) or the site's 404.html. (A chain can't arise: every target is a page, and no old route
 * may be one.) A file next to a page's folder (/guide.html beside /guide/) is another file, so it is free.
 */
export function redirectProblems(files: ReadonlyMap<string, PageFile>, workbenchPath?: string): string[] {
  const problems: string[] = [];
  const claimed = new Map<string, PageFile>();
  for (const f of files.values()) {
    const at = `${f.path}${f.frontmatter.lines["redirectFrom"] !== undefined ? `:${f.frontmatter.lines["redirectFrom"]}` : ""}`;
    for (const old of redirectsOf(f)) {
      const file = typeof old === "string" && old.startsWith("/") && isFileRoute(old);
      if (typeof old !== "string" || !old.startsWith("/") || !(old.endsWith("/") || file)) continue; // a shape problem of the page's own
      if (old === PD_ROUTES.notFound) { problems.push(`${at}: redirectFrom "${old}" is the site's 404 page, which Pattern Dump writes`); continue; }
      if (file && old.endsWith("/index.html")) {
        const folder = old.slice(0, -"index.html".length);
        problems.push(`${at}: redirectFrom "${old}" is the file of the route ${folder}: list "${folder}" instead`);
        continue;
      }
      const page = files.get(old);
      if (page) { problems.push(`${at}: redirectFrom "${old}" is the page ${page.path}: a route can't both be a page and forward to one`); continue; }
      const reserved = RESERVED.find(r => old.startsWith(r));
      if (reserved) { problems.push(`${at}: redirectFrom "${old}" is under ${reserved}, which Pattern Dump serves itself`); continue; }
      if (workbenchPath !== undefined && old.startsWith(workbenchPath)) {
        problems.push(`${at}: redirectFrom "${old}" is ${workbenchPlace(old, workbenchPath)}`);
        continue;
      }
      const other = claimed.get(old);
      if (other && other !== f) { problems.push(`${at}: redirectFrom "${old}" is also claimed by ${other.path}: one old route forwards to one page`); continue; }
      claimed.set(old, f);
    }
  }
  return problems;
}

/** Where a route stands to the same-host workbench's path, which it is at or under (both end in "/"). */
export function workbenchPlace(route: string, workbenchPath: string): string {
  return `${route === workbenchPath ? "at" : "under"} ${workbenchPath}, where the workbench is published on this host `
    + `(site.workbenchUrl), so the workbench would overwrite it there`;
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
