// Declared navigations (storefront/navigations.ts): storefront.site.navigations, whose shape is Pattern
// Dump's. Every entry is checked at any depth, the skin only lists the names it uses, and each navigation is
// resolved per page, with the current entry and every group above it marked.
import { describe, expect, it } from "vitest";
import type { StorefrontNavEntry } from "@pattern-dump/config";
import { checkNavigations, isAllowedHref, listedNavigations, resolveNavigations } from "../src/storefront/navigations.js";
import type { PageModel } from "../src/storefront/pages.js";

const OWNER = "partials/base";
const PAGES = new Set(["index.md", "about.md", "guides/index.md", "guides/setup.md", "guides/deep/index.md", "guides/deep/more.md"]);
const SKIN = { type: "object" as const, properties: { footer: { description: "Links at the foot of every page" }, sidebar: {} }, required: ["footer"] };
const check = (value: unknown, declared = SKIN) => checkNavigations(value, declared, OWNER, PAGES).problems;

describe("checkNavigations — the entries, at any depth", () => {
  it("accepts each form, and groups nested three deep", () => {
    expect(check({
      footer: [
        { page: "about.md" },
        { page: "guides/setup.md", label: "Set up" },
        { href: "https://example.test/source", label: "Source" },
        { href: "mailto:team@example.test", label: "Mail" },
        { href: "/feed.xml", label: "Feed" },
        { label: "Guides", children: [{ label: "Deeper", children: [{ label: "Deepest", children: [{ page: "guides/deep/more.md" }] }] }] },
      ],
    })).toEqual([]);
  });

  it("refuses a page that is not text, a page that is not in the folder, and names where each is", () => {
    expect(check({ footer: [{ page: 5 }, { page: "nope.md" }, { page: "guides/stup.md" }] })).toEqual([
      `storefront.site.navigations.footer[0].page must be the path of a page in the pages folder, such as "about.md" (got 5)`,
      `storefront.site.navigations.footer[1]: "nope.md" is not a page in the pages folder`,
      `storefront.site.navigations.footer[2]: "guides/stup.md" is not a page in the pages folder — did you mean "guides/setup.md"?`,
    ]);
  });

  it("refuses an href that is not http(s), mailto or a path from the root", () => {
    expect(check({ footer: [{ href: "javascript:alert(1)", label: "x" }, { href: "//evil.example/", label: "y" }, { href: "about/", label: "z" }] })).toEqual([
      `storefront.site.navigations.footer[0].href "javascript:alert(1)" must start with https:, http: or mailto:, or be a path from the site's root (/…)`,
      `storefront.site.navigations.footer[1].href "//evil.example/" must start with https:, http: or mailto:, or be a path from the site's root (/…)`,
      `storefront.site.navigations.footer[2].href "about/" must start with https:, http: or mailto:, or be a path from the site's root (/…)`,
    ]);
    expect(isAllowedHref("HTTPS://example.test/")).toBe(true);
  });

  it("refuses a label alone, two forms at once, a missing label, and an unknown key, suggesting the one meant", () => {
    expect(check({ footer: [{ label: "Alone" }, { page: "about.md", href: "/x" }, { href: "/x" }, { page: "about.md", lable: "About" }, "about.md"] })).toEqual([
      `storefront.site.navigations.footer[0] needs "page", "href" or "children": an entry is one of { page }, { href, label } or { label, children }`,
      `storefront.site.navigations.footer[1] has "page" and "href": an entry is one of { page }, { href, label } or { label, children }`,
      `storefront.site.navigations.footer[2] needs a "label"`,
      `storefront.site.navigations.footer[3]: "lable" is not a key of a navigation entry — did you mean "label"?`,
      `storefront.site.navigations.footer[4] must be an entry, one of { page }, { href, label } or { label, children } (got "about.md")`,
    ]);
  });

  it("finds a problem three groups down, with its whole path", () => {
    expect(check({ footer: [{ label: "A", children: [{ label: "B", children: [{ label: "C", children: [{ page: 5 }] }] }] }] })).toEqual([
      `storefront.site.navigations.footer[0].children[0].children[0].children[0].page must be the path of a page in the pages folder, such as "about.md" (got 5)`,
    ]);
  });

  it("refuses navigations that are not an object, and a navigation that is not a list", () => {
    expect(check([{ page: "about.md" }])).toEqual([`storefront.site.navigations must be an object of named navigations, such as { footer: [{ page: "about.md" }] } (got [{"page":"about.md"}])`]);
    expect(check({ footer: { page: "about.md" } })).toEqual([`storefront.site.navigations.footer must be a list of entries (got {"page":"about.md"})`]);
  });
});

describe("checkNavigations — what the skin lists", () => {
  it("refuses a navigation the skin does not list, suggesting the one meant", () => {
    expect(check({ footer: [], foter: [] })).toEqual([
      `storefront.site.navigations.foter is not a navigation partials/base lists (it lists "footer", "sidebar") — did you mean "footer"?`,
    ]);
    expect(checkNavigations({ footer: [] }, undefined, OWNER, PAGES).problems).toEqual([
      `storefront.site.navigations.footer is set, but partials/base lists no navigations, so no layout can show it`,
    ]);
  });

  it("requires what the skin requires", () => {
    expect(check({ sidebar: [] })).toEqual([`storefront.site.navigations.footer is required by partials/base`]);
    expect(check(undefined)).toEqual([`storefront.site.navigations.footer is required by partials/base`]);
  });

  it("refuses a shape declared for a navigation: the shape is Pattern Dump's", () => {
    expect(listedNavigations({ properties: { footer: { type: "array", items: { type: "object" } } } }, OWNER).problems).toEqual([
      `partials/base declares "type", "items" for site.navigations.footer: the shape of a navigation is Pattern Dump's, so list the name only (a description at most)`,
    ]);
    expect(listedNavigations({ type: "array", properties: {} }, OWNER).problems).toEqual([
      `partials/base declares a shape for site.navigations: the shape of a navigation is Pattern Dump's, so list its names under properties only`,
    ]);
    expect(listedNavigations(SKIN, OWNER)).toEqual({ listed: ["footer", "sidebar"], problems: [] });
  });
});

describe("resolveNavigations", () => {
  const model = {
    pages: [
      { route: "/", title: "Home", layout: "page" }, { route: "/about/", title: "About", layout: "page" },
      { route: "/guides/", title: "Guides", layout: "page" }, { route: "/guides/setup/", title: "Setup", layout: "page" },
      { route: "/guides/deep/", title: "Deep", layout: "page" }, { route: "/guides/deep/more/", title: "More", layout: "page" },
    ],
    nav: [],
    files: new Map([...PAGES].map(path => {
      const route = path === "index.md" ? "/" : `/${path.replace(/(\/index)?\.md$/, "").replace(/^index$/, "")}/`;
      return [route, { route, path, file: path, frontmatter: { values: {}, errors: [], lines: {} } }];
    })),
    problems: [],
  } as unknown as PageModel;
  const footer: StorefrontNavEntry[] = [
    { page: "about.md" },
    { href: "https://example.test/source", label: "Source" },
    { label: "Guides", children: [
      { page: "guides/setup.md", label: "Set up" },
      { label: "Deeper", children: [{ label: "Deepest", children: [{ page: "guides/deep/more.md" }] }] },
    ] },
  ];

  it("labels a page by its title unless the entry says otherwise, and keeps an external link as it is", () => {
    expect(resolveNavigations({ footer }, ["footer"], model, "/")["footer"]).toEqual([
      { label: "About", route: "/about/" },
      { label: "Source", href: "https://example.test/source" },
      { label: "Guides", children: [
        { label: "Set up", route: "/guides/setup/" },
        { label: "Deeper", children: [{ label: "Deepest", children: [{ label: "More", route: "/guides/deep/more/" }] }] },
      ] },
    ]);
  });

  it("marks the current page's entry, three groups down, and every group above it", () => {
    const [, , guides] = resolveNavigations({ footer }, ["footer"], model, "/guides/deep/more/")["footer"]!;
    expect(guides).toEqual({ label: "Guides", ancestor: true, children: [
      { label: "Set up", route: "/guides/setup/" },
      { label: "Deeper", ancestor: true, children: [{ label: "Deepest", ancestor: true, children: [{ label: "More", route: "/guides/deep/more/", current: true }] }] },
    ] });
  });

  it("gives a listed navigation the config does not set null", () => {
    expect(resolveNavigations({ footer: [] }, ["footer", "sidebar"], model, "/")).toEqual({ footer: [], sidebar: null });
  });
});
