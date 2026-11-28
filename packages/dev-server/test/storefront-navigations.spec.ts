// Declared navigations (storefront/navigations.ts): storefront.site.navigations, whose shape is Pattern
// Dump's. Every entry is checked at any depth, the skin only lists the names it uses, and each navigation is
// resolved per page, with the current entry and every group above it marked.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { StorefrontNavEntry } from "@pattern-dump/config";
import { checkNavigations, isAllowedHref, listedNavigations, resolveNavigations } from "../src/storefront/navigations.js";
import { readPages, type PageModel } from "../src/storefront/pages.js";
import { save } from "../../../test-support/save.js";

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
      `site.globals.navigations.footer[0].page must be the path of a page in the pages folder, such as "about.md" (got 5)`,
      `site.globals.navigations.footer[1]: "nope.md" is not a page in the pages folder`,
      `site.globals.navigations.footer[2]: "guides/stup.md" is not a page in the pages folder: did you mean "guides/setup.md"?`,
    ]);
  });

  it("refuses an href that is not http(s), mailto or a path from the root", () => {
    expect(check({ footer: [{ href: "javascript:alert(1)", label: "x" }, { href: "//evil.example/", label: "y" }, { href: "about/", label: "z" }] })).toEqual([
      `site.globals.navigations.footer[0].href "javascript:alert(1)" must start with https:, http: or mailto:, or be a path from the site's root (/…)`,
      `site.globals.navigations.footer[1].href "//evil.example/" must start with https:, http: or mailto:, or be a path from the site's root (/…)`,
      `site.globals.navigations.footer[2].href "about/" must start with https:, http: or mailto:, or be a path from the site's root (/…)`,
    ]);
    expect(isAllowedHref("HTTPS://example.test/")).toBe(true);
  });

  // A page with children is a form of its own now; a page with an href, or an href with children, is still two.
  it("refuses a label alone, a page or children with an href, a missing label, and an unknown key, suggesting the one meant", () => {
    expect(check({ footer: [{ label: "Alone" }, { page: "about.md", href: "/x" }, { href: "/x" }, { page: "about.md", lable: "About" }, "about.md", { href: "/x", label: "X", children: [] }] })).toEqual([
      `site.globals.navigations.footer[0] needs "page", "href" or "children": an entry is one of { page }, { page, children }, { href, label } or { label, children }`,
      `site.globals.navigations.footer[1] has "page" and "href": an entry is one of { page }, { page, children }, { href, label } or { label, children }`,
      `site.globals.navigations.footer[2] needs a "label"`,
      `site.globals.navigations.footer[3]: "lable" is not a key of a navigation entry: did you mean "label"?`,
      `site.globals.navigations.footer[4] must be an entry, one of { page }, { page, children }, { href, label } or { label, children } (got "about.md")`,
      `site.globals.navigations.footer[5] has "href" and "children": an entry is one of { page }, { page, children }, { href, label } or { label, children }`,
    ]);
  });

  it("accepts a page that is a parent too: with a list, and with \"folder\" on a folder's index.md", () => {
    expect(check({
      footer: [
        { page: "guides/index.md", children: [{ page: "guides/setup.md" }, { href: "/feed.xml", label: "Feed" }] },
        { page: "guides/index.md", label: "Guides", children: "folder" },
        { page: "index.md", children: "folder" },
        { label: "More", children: [{ page: "guides/deep/index.md", children: "folder" }] },
      ],
    })).toEqual([]);
  });

  it("refuses \"folder\" anywhere but on a folder's index.md, and children that are neither a list nor \"folder\"", () => {
    expect(check({ footer: [
      { page: "guides/setup.md", children: "folder" },
      { label: "Guides", children: "folder" },
      { page: "guides/index.md", children: "folders" },
      { page: "guides/index.md", children: [{ page: "guides/setup.md", children: "folder" }] },
    ] })).toEqual([
      `site.globals.navigations.footer[0].children is "folder", which lists a folder's pages: it works only on a folder's index.md, and "guides/setup.md" is not one`,
      `site.globals.navigations.footer[1].children is "folder", which lists a folder's pages: it needs the folder's index.md as "page", such as { page: "guides/index.md", children: "folder" }`,
      `site.globals.navigations.footer[2].children must be a list of entries, or "folder" on a folder's index.md (got "folders")`,
      `site.globals.navigations.footer[3].children[0].children is "folder", which lists a folder's pages: it works only on a folder's index.md, and "guides/setup.md" is not one`,
    ]);
  });

  it("finds a problem three groups down, with its whole path", () => {
    expect(check({ footer: [{ label: "A", children: [{ label: "B", children: [{ label: "C", children: [{ page: 5 }] }] }] }] })).toEqual([
      `site.globals.navigations.footer[0].children[0].children[0].children[0].page must be the path of a page in the pages folder, such as "about.md" (got 5)`,
    ]);
  });

  it("refuses navigations that are not an object, and a navigation that is not a list", () => {
    expect(check([{ page: "about.md" }])).toEqual([`site.globals.navigations must be an object of named navigations, such as { footer: [{ page: "about.md" }] } (got [{"page":"about.md"}])`]);
    expect(check({ footer: { page: "about.md" } })).toEqual([`site.globals.navigations.footer must be a list of entries (got {"page":"about.md"})`]);
  });
});

describe("checkNavigations — what the skin lists", () => {
  it("refuses a navigation the skin does not list, suggesting the one meant", () => {
    expect(check({ footer: [], foter: [] })).toEqual([
      `site.globals.navigations.foter is not a navigation partials/base lists (it lists "footer", "sidebar"): did you mean "footer"?`,
    ]);
    expect(checkNavigations({ footer: [] }, undefined, OWNER, PAGES).problems).toEqual([
      `site.globals.navigations.footer is set, but partials/base lists no navigations, so no layout can show it`,
    ]);
  });

  it("requires what the skin requires", () => {
    expect(check({ sidebar: [] })).toEqual([`site.globals.navigations.footer is required by partials/base`]);
    expect(check(undefined)).toEqual([`site.globals.navigations.footer is required by partials/base`]);
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

describe("resolveNavigations — a page with children", () => {
  // A real pages folder, so "folder" lists what readPages lists: its order, a subfolder by its index.md.
  let dir = "";
  let model: PageModel;
  const write = async (files: Record<string, string>) => {
    for (const [rel, fm] of Object.entries(files)) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await save(join(dir, rel), `---\n${fm}\n---\nText.\n`);
    }
  };
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pd-nav-folders-"));
    await write({
      "index.md": "title: Home",
      "about.md": "title: About",
      "how-to/index.md": "title: How to",
      "how-to/start.md": "title: Start\norder: 1",
      "how-to/hidden.md": "title: Hidden\norder: 2\nnav: false",
      "how-to/theme.md": "title: Theme\norder: 3",
      "how-to/deep/index.md": "title: Deep\norder: 4",
      "how-to/deep/below.md": "title: Below",
    });
    model = await readPages(dir);
  });
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  const nav = (entries: StorefrontNavEntry[], route: string) => resolveNavigations({ footer: entries }, ["footer"], model, route)["footer"];
  const folder: StorefrontNavEntry = { page: "how-to/index.md", label: "How To's", children: "folder" };

  it("gives a page with a list of children its route and its children", () => {
    expect(nav([{ page: "how-to/index.md", children: [{ page: "about.md" }, { href: "/feed.xml", label: "Feed" }] }], "/")).toEqual([
      { label: "How to", route: "/how-to/", children: [{ label: "About", route: "/about/" }, { label: "Feed", href: "/feed.xml" }] },
    ]);
  });

  it("lists the folder's pages in their order, without nav: false, a subfolder by its index.md and nothing below it", () => {
    expect(nav([folder], "/")).toEqual([
      { label: "How To's", route: "/how-to/", children: [
        { label: "Start", route: "/how-to/start/" },
        { label: "Theme", route: "/how-to/theme/" },
        { label: "Deep", route: "/how-to/deep/" },
      ] },
    ]);
  });

  it("marks a current child and the entry above it as its ancestor", () => {
    expect(nav([folder], "/how-to/theme/")).toEqual([
      { label: "How To's", route: "/how-to/", ancestor: true, children: [
        { label: "Start", route: "/how-to/start/" },
        { label: "Theme", route: "/how-to/theme/", current: true },
        { label: "Deep", route: "/how-to/deep/" },
      ] },
    ]);
  });

  it("marks the entry itself current on its own page, with no child current", () => {
    const [entry] = nav([folder], "/how-to/")!;
    expect(entry).toMatchObject({ route: "/how-to/", current: true });
    expect(entry).not.toHaveProperty("ancestor");
    expect(entry!.children!.some(c => c.current)).toBe(false);
  });

  it("marks no ancestor for a page below a subfolder: the folder's listing is one level deep", () => {
    const [entry] = nav([folder], "/how-to/deep/below/")!;
    expect(entry).not.toHaveProperty("ancestor");
  });
});
