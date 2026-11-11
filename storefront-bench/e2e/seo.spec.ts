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
  });
}
