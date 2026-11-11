// What a search engine or a link preview reads off a page: the canonical URL and Open Graph, as the
// browser parsed them from the head, on every bench page. In pd dev the page's own address is the one the
// browser is on; in the built site, storefront.url.
import { expect, test } from "./fixtures.js";
import { DEV, isDev, SITE_URL } from "./helpers.js";

// The site's image (storefront.image, 240 × 126) unless the page names its own (about.md, 200 × 100).
const SHARE = ["/assets/images/share.png", "240", "126"] as const;
const PAGES = [
  ["/", "Storefront bench", SHARE], ["/about/", "About", ["/assets/images/about.png", "200", "100"]],
  ["/guides/", "Guides", SHARE], ["/guides/setup/", "Setup", SHARE],
] as const;
/** The trail each page's JSON-LD gives, Home first, the page last; the home page has none. */
const TRAILS: Record<string, string[]> = {
  "/": [], "/about/": ["Storefront bench", "About"], "/guides/": ["Storefront bench", "Guides"],
  "/guides/setup/": ["Storefront bench", "Guides", "Setup"],
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
    }));
    const url = new URL(route.slice(1), site).href;
    expect(head.canonical).toBe(url);
    expect(head.meta["og:url"]).toBe(url);
    expect(head.meta["og:title"]).toBe(title);
    expect(head.meta["og:type"]).toBe("website");
    expect(head.meta["og:site_name"]).toBe("Storefront bench");
    expect(head.meta["og:image"]).toBe(new URL(image.slice(1), site).href);
    expect([head.meta["og:image:width"], head.meta["og:image:height"]]).toEqual([width, height]);
    expect(head.meta["twitter:card"]).toBe("summary_large_image");
    // The image is served where the site serves it: at the same path on the server under test.
    const res = await request.get(image);
    expect(res.status(), image).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    expect(head.meta["robots"]).toBeUndefined();
    expect(head.lang).toBe("en");

    // The structured data, as the browser holds it: one script, parsed as it is.
    const scripts = await page.locator(`script[type="application/ld+json"]`).allTextContents();
    expect(scripts).toHaveLength(1);
    const graph = (JSON.parse(scripts[0]!) as { "@graph": Array<Record<string, any>> })["@graph"];
    expect(graph.map(n => n["@type"])).toEqual(["WebSite", "WebPage"]);
    expect(graph[0]).toMatchObject({ url: site, name: "Storefront bench" });
    expect(graph[1]).toMatchObject({ url, name: title });
    // Every bench page is committed, so git dates it (the checkout has its full history, in CI too).
    expect(graph[1]!["dateModified"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/);
    const trail = graph[1]!["breadcrumb"]?.itemListElement ?? [];
    expect(trail.map((i: { name: string }) => i.name)).toEqual(TRAILS[route]);
    if (trail.length) expect(trail.at(-1).item).toBe(url);
  });
}
