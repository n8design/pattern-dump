// The storefront's files for crawlers, at the root of its host: robots.txt, and sitemap.xml when the site has
// an address (storefront.url). Both are text built from the page model on every request, never stored.

/** A page in the sitemap: its absolute URL, and its last change when git has a reliable one. */
export interface SitemapEntry { url: string; lastmod: string | null }

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** sitemap.xml (sitemaps.org 0.9): one <url> per entry, in the order given; <lastmod> only where known. */
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map(e => `<url><loc>${escapeXml(e.url)}</loc>${e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + `${urls.map(u => `${u}\n`).join("")}</urlset>\n`;
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
