// The storefront's files for crawlers, at the root of its host: robots.txt, and sitemap.xml when the site has
// an address (storefront.url). Both are text built from the page model on every request, never stored. And
// llms.txt, for language models, which only pd build writes.

import type { StorefrontFeed } from "@pattern-dump/contracts";
import type { PageModel } from "./pages.js";
import { escapeXml } from "./xml.js";

/** A page in the sitemap: its absolute URL, and its last change when the page says. */
export interface SitemapEntry { url: string; lastmod: string | null }

/**
 * The sitemap's pages, by route, each but a page with `index: false`: its lastmod is the page's own `updated`, else its
 * own `date`, else left out. Git is never asked: its last commit counts a typo fix as a change.
 */
export function sitemapEntries(model: PageModel, siteUrl: string): SitemapEntry[] {
  return [...model.pages].sort((a, b) => a.route.localeCompare(b.route)).flatMap(p => {
    // A tag or category page, or an index of them: its newest page's change.
    const generated = model.generated.get(p.route);
    if (generated) return [{ url: new URL(p.route.slice(1), siteUrl).href, lastmod: generated.lastmod }];
    const file = model.files.get(p.route);
    if (!file || file.frontmatter.values["index"] === "false") return [];
    const e = model.entries.get(p.route);
    return [{ url: new URL(p.route.slice(1), siteUrl).href, lastmod: e?.updated ?? e?.date ?? null }];
  });
}

/** sitemap.xml (sitemaps.org 0.9): one <url> per entry, in the order given; <lastmod> only where known. */
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map(e => `<url><loc>${escapeXml(e.url)}</loc>${e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + `${urls.map(u => `${u}\n`).join("")}</urlset>\n`;
}

/**
 * llms.txt (llmstxt.org), which pd build writes: `# <title>`, the home page's description (or teaser) as a quote,
 * then `## Pages` (the top-level pages but the home page) and a section per collection (a folder with an index.md,
 * headed by its title and led by it), in nav order. Each page is `- [title](url): teaser`, its description else its
 * first paragraph; no `: ` part when it has neither. The same pages as the sitemap: no draft, no scheduled page, no
 * page with `index: false`; a section with none left is not written. Tag and category pages are left out: they have
 * no content of their own, and their pages are listed. Then `## Feeds`, the site's feed first, each by its title and
 * format (`feeds`, as the pages response lists them; none without the site's address). `siteUrl`: absolute URLs;
 * without it, the route.
 */
export function llmsTxt(model: PageModel, o: { title: string | undefined; siteUrl: string | undefined; feeds?: readonly StorefrontFeed[] }): { text: string; pages: number } {
  const titles = new Map(model.pages.map(p => [p.route, p.title]));
  const listed = (route: string): boolean => {
    const file = model.files.get(route), entry = model.entries.get(route);
    return !!file && !!entry && !entry.draft && !entry.scheduled && file.frontmatter.values["index"] !== "false";
  };
  const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
  const linkText = (s: string): string => oneLine(s).replace(/[[\]\\]/g, m => `\\${m}`);
  const href = (route: string): string => o.siteUrl !== undefined ? new URL(route.slice(1), o.siteUrl).href : route;
  const line = (route: string): string => {
    const teaser = model.entries.get(route)?.description;
    return `- [${linkText(titles.get(route) ?? route)}](${href(route)})${teaser ? `: ${oneLine(teaser)}` : ""}`;
  };
  const pagesOf = (folder: string): string[] => (model.folders.get(folder)?.children ?? []).filter(r => r !== "/" && !model.folders.has(r));
  const sections: { heading: string; routes: string[] }[] = [{ heading: "Pages", routes: pagesOf("/") }];
  for (const p of model.pages) {
    if (p.route !== "/" && model.folders.has(p.route)) sections.push({ heading: p.title, routes: [p.route, ...pagesOf(p.route)] });
  }
  const out = [`# ${oneLine(o.title ?? titles.get("/") ?? "Site")}`, ""];
  const about = listed("/") ? model.entries.get("/")?.description : null;
  if (about) out.push(`> ${oneLine(about)}`, "");
  let pages = 0;
  for (const s of sections) {
    const routes = s.routes.filter(listed);
    if (!routes.length) continue;
    pages += routes.length;
    out.push(`## ${oneLine(s.heading)}`, "", ...routes.map(line), "");
  }
  // The feeds, the site's first: each by its title and format, at its absolute address.
  const feeds = [...(o.feeds ?? [])].sort((a, b) => (a.collection === null ? 0 : 1) - (b.collection === null ? 0 : 1));
  if (feeds.length && o.siteUrl !== undefined) {
    out.push("## Feeds", "", ...feeds.map(f => `- [${linkText(f.title)}](${href(f.address)}): ${f.format === "atom" ? "Atom" : "RSS"}`), "");
  }
  return { text: out.join("\n"), pages };
}

/**
 * The workbench's robots.txt: the workbench stays searchable, its previews (/preview/ under the base path) do
 * not. Crawlers read robots.txt only at a host's root, so under a base path other than "/" the file in the
 * output's root takes effect only where the host serves it from its root (the build says so).
 */
export function workbenchRobotsTxt(basePath: string): string {
  return `User-agent: *\nDisallow: ${basePath}preview/\n`;
}

/**
 * The storefront's robots.txt. Previews (/preview/) are kept from crawlers: they are component demos, embedded
 * in pages, not pages of their own. A workbench published on the same host (`workbenchPath`, from
 * sameHostWorkbenchPath) has its previews kept out here too, since crawlers read robots.txt only at the host's
 * root and never the workbench's own. A site with index: false (a staging site) is kept out entirely, and lists
 * no sitemap. The Sitemap line needs the site's address.
 */
export function storefrontRobotsTxt(p: { siteUrl: string | undefined; index: boolean; workbenchPath?: string | undefined }): string {
  if (!p.index) return "User-agent: *\nDisallow: /\n";
  const workbench = p.workbenchPath !== undefined ? `Disallow: ${p.workbenchPath}preview/\n` : "";
  return `User-agent: *\nDisallow: /preview/\n${workbench}${p.siteUrl !== undefined ? `\nSitemap: ${p.siteUrl}sitemap.xml\n` : ""}`;
}
