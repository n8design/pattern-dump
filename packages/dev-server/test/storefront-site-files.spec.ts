// The storefront's files for crawlers (site-files.ts): sitemap.xml and robots.txt, as text.
import { describe, expect, it } from "vitest";
import { sitemapXml, storefrontRobotsTxt } from "../src/storefront/site-files.js";

describe("sitemapXml", () => {
  it("lists each page once, in the order given, with lastmod only where it is known", () => {
    expect(sitemapXml([
      { url: "https://example.test/", lastmod: "2026-02-10T10:00:00+01:00" },
      { url: "https://example.test/about/", lastmod: null },
    ])).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.test/</loc><lastmod>2026-02-10T10:00:00+01:00</lastmod></url>
<url><loc>https://example.test/about/</loc></url>
</urlset>
`);
  });

  it("escapes what XML needs escaped in a URL", () => {
    expect(sitemapXml([{ url: "https://example.test/a&b/'q'/", lastmod: null }]))
      .toContain("<loc>https://example.test/a&amp;b/&apos;q&apos;/</loc>");
  });

  it("is a valid empty sitemap for a site with no page to list", () => {
    expect(sitemapXml([])).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`);
  });
});

describe("storefrontRobotsTxt", () => {
  it("keeps crawlers out of the previews and names the sitemap", () => {
    expect(storefrontRobotsTxt({ siteUrl: "https://example.test/", index: true }))
      .toBe("User-agent: *\nDisallow: /preview/\n\nSitemap: https://example.test/sitemap.xml\n");
  });

  it("names no sitemap without the site's address", () => {
    expect(storefrontRobotsTxt({ siteUrl: undefined, index: true })).toBe("User-agent: *\nDisallow: /preview/\n");
  });

  it("keeps a site with index: false out entirely, with no sitemap", () => {
    expect(storefrontRobotsTxt({ siteUrl: "https://example.test/", index: false })).toBe("User-agent: *\nDisallow: /\n");
  });
});
