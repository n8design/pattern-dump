// What a search engine or a link preview reads off a page: the canonical URL and Open Graph, as the
// browser parsed them from the head, on every bench page. In pd dev the page's own address is the one the
// browser is on; in the built site, storefront.url.
import { createHash } from "node:crypto";
import { expect, test } from "./fixtures.js";
import { DEV, isDev, SITE_URL } from "./helpers.js";

// The site's image (storefront.image, 240 × 126) unless the page names its own (about.md, 200 × 100).
const SHARE = ["/assets/images/share.png", "240", "126"] as const;
const PAGES = [
  ["/", "Storefront bench", SHARE], ["/about/", "About", ["/assets/images/about.png", "200", "100"]],
  ["/guides/", "Guides", SHARE], ["/guides/setup/", "Setup", SHARE],
  ["/articles/", "Articles", SHARE], ["/articles/harbour/", "A harbour of cable cars", ["/assets/images/cable-cars.jpg", "2400", "1600"]],
  ["/articles/plain/", "Plain on purpose", SHARE],
] as const;
/** The trail each page's JSON-LD gives, Home first, the page last; the home page has none. */
const TRAILS: Record<string, string[]> = {
  "/": [], "/about/": ["Storefront bench", "About"], "/guides/": ["Storefront bench", "Guides"],
  "/guides/setup/": ["Storefront bench", "Guides", "Setup"],
  "/articles/": ["Storefront bench", "Articles"], "/articles/harbour/": ["Storefront bench", "Articles", "A harbour of cable cars"],
  "/articles/plain/": ["Storefront bench", "Articles", "Plain on purpose"],
};
/** A page's own date (frontmatter date), which its JSON-LD gives as datePublished. */
const PUBLISHED: Record<string, string> = { "/articles/harbour/": "2026-11-01", "/articles/plain/": "2026-10-02" };
/** The pages with an updated date of their own: their dateModified and lastmod. */
const UPDATED: Record<string, string> = { "/guides/setup/": "2026-11-15" };
/** The articles: the pages with their own date (not the home page, not a listing), and their tags' labels. */
const ARTICLE_TAGS: Record<string, string[]> = { "/articles/harbour/": ["Images", "Layout"], "/articles/plain/": ["Design"] };
/** An article's categories' labels: article:section is the first, the Article's articleSection all of them. */
const SECTIONS: Record<string, string[]> = { "/articles/plain/": ["Design systems"] };
/** The tag and category pages, with their sitemap lastmod: the newest change of their pages. */
const GENERATED: Record<string, string> = {
  "/tags/": "2026-11-01", "/tags/design/": "2026-10-02", "/tags/images/": "2026-11-01", "/tags/layout/": "2026-11-01",
  "/categories/": "2026-11-15", "/categories/design-systems/": "2026-11-15", "/categories/guides/": "2026-11-15",
};

for (const [route, title, [image, width, height]] of PAGES) {
  test(`${route}: canonical, Open Graph and the card, at the site's address`, async ({ page, request }, info) => {
    const site = isDev(info) ? `${DEV}/` : SITE_URL;
    await page.goto(route);
    const head = await page.evaluate(() => ({
      canonical: document.querySelector<HTMLLinkElement>("link[rel=canonical]")?.href ?? null,
      meta: Object.fromEntries([...document.querySelectorAll("meta[property], meta[name]")]
        .map(m => [m.getAttribute("property") ?? m.getAttribute("name"), m.getAttribute("content")])),
      lang: document.documentElement.lang,
      tags: [...document.querySelectorAll(`meta[property="article:tag"]`)].map(m => m.getAttribute("content")),
    }));
    const url = new URL(route.slice(1), site).href;
    expect(head.canonical).toBe(url);
    expect(head.meta["og:url"]).toBe(url);
    expect(head.meta["og:title"]).toBe(title);
    const article = ARTICLE_TAGS[route];
    expect(head.meta["og:type"]).toBe(article ? "article" : "website");
    expect(head.meta["article:published_time"]).toBe(article ? PUBLISHED[route] : undefined);
    expect(head.tags).toEqual(article ?? []);
    expect(head.meta["article:section"]).toBe(article ? SECTIONS[route]?.[0] : undefined);
    expect(head.meta["og:site_name"]).toBe("Storefront bench");
    expect([head.meta["og:image:width"], head.meta["og:image:height"]]).toEqual([width, height]);
    expect(head.meta["twitter:card"]).toBe("summary_large_image");
    // The image is served where the site serves it: at the same path on the server under test. Its URL is
    // stamped with the content hash of what is served there, so a changed image gets a new URL.
    const res = await request.get(image);
    expect(res.status(), image).toBe(200);
    expect(res.headers()["content-type"]).toContain(image.endsWith(".jpg") ? "image/jpeg" : "image/png");
    const stamp = createHash("sha256").update(await res.body()).digest("hex").slice(0, 10);
    expect(head.meta["og:image"]).toBe(`${new URL(image.slice(1), site).href}?v=${stamp}`);
    // X reads its own tag: the same image, at the same stamped address.
    expect(head.meta["twitter:image"]).toBe(head.meta["og:image"]);
    expect(head.meta["robots"]).toBeUndefined();
    expect(head.lang).toBe("en");

    // The structured data, as the browser holds it: one script, parsed as it is.
    const scripts = await page.locator(`script[type="application/ld+json"]`).allTextContents();
    expect(scripts).toHaveLength(1);
    type Node = Record<string, unknown> & { breadcrumb?: { itemListElement: Array<{ name: string; item: string }> } };
    const graph = (JSON.parse(scripts[0]!) as { "@graph": Node[] })["@graph"];
    expect(graph.map(n => n["@type"])).toEqual(article ? ["WebSite", "WebPage", "Article"] : ["WebSite", "WebPage"]);
    if (article) {
      expect(graph[2]).toMatchObject({ headline: title, mainEntityOfPage: { "@id": url }, datePublished: PUBLISHED[route],
        ...(article.length ? { keywords: article } : {}) });
      const sections = SECTIONS[route] ?? [];
      expect(graph[2]!["articleSection"]).toEqual(sections.length > 1 ? sections : sections[0]);
      expect(graph[2]!["dateModified"]).toBe(graph[1]!["dateModified"]);
    }
    expect(graph[0]).toMatchObject({ url: site, name: "Storefront bench" });
    expect(graph[1]).toMatchObject({ url, name: title });
    // dateModified: the page's own updated, never git's last commit.
    expect(graph[1]!["dateModified"]).toBe(UPDATED[route]);
    // datePublished: the page's own date where it has one, else the day git first saw it.
    if (PUBLISHED[route]) expect(graph[1]!["datePublished"]).toBe(PUBLISHED[route]);
    else expect(graph[1]!["datePublished"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/);
    const trail = graph[1]!.breadcrumb?.itemListElement ?? [];
    expect(trail.map(i => i.name)).toEqual(TRAILS[route]);
    if (trail.length) expect(trail.at(-1)!.item).toBe(url);
  });
}

test("robots.txt keeps crawlers out of the previews and names the sitemap; the sitemap lists every page, dated by the page", async ({ request }, info) => {
  const site = isDev(info) ? `${DEV}/` : SITE_URL;
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toBe(`User-agent: *\nDisallow: /preview/\n\nSitemap: ${site}sitemap.xml\n`);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const entries = [...(await sitemap.text()).matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)];
  expect(entries.map(m => m[1])).toEqual([...PAGES.map(([route]) => route), ...Object.keys(GENERATED)].map(route => new URL(route.slice(1), site).href).sort());
  // lastmod: the page's own updated, else its own date, else none; never git's last commit. A tag or category page:
  // its pages' newest.
  for (const m of entries) {
    const route = new URL(m[1]!).pathname.slice(new URL(site).pathname.length - 1);
    expect(m[2], m[1]).toBe(GENERATED[route] ?? UPDATED[route] ?? PUBLISHED[route]);
  }
});
