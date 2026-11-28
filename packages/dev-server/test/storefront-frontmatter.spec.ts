// A storefront page's frontmatter, checked against its layout's declared schema (D3, D7): every way a
// page can be wrong, each with its exact message and line, and the coercions a declared type allows.
// Nothing is inferred — not from the layout's sample data, not from the values themselves.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { readFrontmatterStrict } from "../src/frontmatter.js";
import { readPages, type PageFile } from "../src/storefront/pages.js";
import { checkPageFrontmatter, layoutNames } from "../src/storefront/frontmatter-contract.js";
import { save } from "../../../test-support/save.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

let tmp = "";
let map: DiscoveryMap;

const SCHEMAS: Record<string, unknown> = {
  "layouts/page/page.schema.json": {
    required: ["title"],
    properties: { title: { type: "string" }, description: { type: "string" } },
  },
  "layouts/claims/claims.schema.json": {
    properties: { title: { type: "string" }, image: { type: "string" }, order: { type: "number" } },
  },
  "layouts/listing/listing.schema.json": {
    properties: { title: { type: "string" }, date: { type: "string" }, tags: { type: "array" }, draft: { type: "boolean" }, sort: { type: "string" } },
  },
  "layouts/typed/typed.schema.json": {
    required: ["title", "body"],
    properties: {
      title: { type: "string" },
      count: { type: "number" },
      n: { type: "integer" },
      pinned: { type: "boolean" },
      labels: { type: "array", items: { type: "string" } },
      scores: { type: "array", items: { type: "number" } },
      tone: { type: "string", enum: ["warning", "info"] },
      either: { type: ["number", "string"] },
      free: {},
    },
  },
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-page-contract-"));
  const files: Record<string, string> = {
    "layouts/page/page.hbs": "<main>{{title}}{{{body}}}</main>",
    "layouts/page/page.json": `{ "title": "Sample", "brand": { "name": "Sample brand" } }`,
    "layouts/page/page~x.json": `{ "title": "A variant" }`,
    "layouts/typed/typed.hbs": "<main>{{title}}</main>",
    "layouts/claims/claims.hbs": "<main>{{title}}</main>",
    "layouts/listing/listing.hbs": "<main>{{title}}</main>",
    "layouts/bare/bare.hbs": "<main>{{{body}}}</main>",
    "layouts/broken/broken.hbs": "<main></main>",
    "layouts/broken/broken.schema.json": "{ not json",
    "partials/base/base.hbs": "<div>{{> @partial-block}}</div>",
  };
  for (const [path, schema] of Object.entries(SCHEMAS)) files[path] = JSON.stringify(schema);
  for (const [path, body] of Object.entries(files)) {
    const file = join(tmp, "patterns", ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await save(file, body);
  }
  map = (await buildDiscoveryMap(join(tmp, "patterns"))).discoveryMap;
});

afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const pageFile = (md: string, path = "guides/setup.md"): PageFile =>
  ({ route: "/guides/setup/", file: `/x/${path}`, path, frontmatter: readFrontmatterStrict(md) });
const check = (md: string, discovery: DiscoveryMap = map) => checkPageFrontmatter(pageFile(md), discovery);
const P = (line: number | undefined, message: string) => ({ file: "guides/setup.md", ...(line !== undefined ? { line } : {}), message });

describe("layoutNames", () => {
  it("lists the base components directly under layouts/, not variants or partials", async () => {
    expect(await layoutNames(map)).toEqual(["bare", "broken", "claims", "listing", "page", "typed"]);
  });
});

describe("checkPageFrontmatter — a valid page", () => {
  it("uses the page layout when none is named, and passes the declared values on, without layout or order", async () => {
    expect(await check("---\ntitle: Setup\ndescription: How\norder: 2\n---\n")).toEqual({
      layoutId: "layouts/page", layoutName: "page", bodySlot: "body", values: { title: "Setup", description: "How" }, build: {}, problems: [], notes: [],
    });
  });

  it("uses the layout it names", async () => {
    const r = await check("---\nlayout: typed\ntitle: T\n---\n");
    expect(r.layoutId).toBe("layouts/typed");
    expect(r.problems).toEqual([]);
  });
});

describe("checkPageFrontmatter — the layout", () => {
  const known = `the layouts are "bare", "broken", "claims", "listing", "page", "typed"`;
  for (const [label, value] of [["an unknown name", "nope"], ["a partial", "base"], ["a variant", "page~x"], ["a path", "../partials/base"]] as const) {
    it(`refuses ${label}, naming the layouts there are`, async () => {
      expect((await check(`---\ntitle: T\nlayout: ${value}\n---\n`)).problems).toEqual([P(3, `layout "${value}" is not a layout: ${known}`)]);
    });
  }

  it("refuses a list", async () => {
    expect((await check("---\nlayout: [page, typed]\ntitle: T\n---\n")).problems).toEqual([P(2, "layout must be one layout name, not a list")]);
  });

  it("says so when the project has no layouts at all", async () => {
    expect((await check("---\ntitle: T\n---\n", new Map())).problems).toEqual([
      P(undefined, `layout "page" is not a layout: the project has no layouts (components in a layouts/ folder of its patterns, or `
        + `page and template patterns marked with x-pd-layout)`),
    ]);
  });

  it("reports a layout schema that cannot be read", async () => {
    const r = await check("---\nlayout: broken\ntitle: T\n---\n");
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].message).toMatch(/^the schema of layout "broken" cannot be read: /);
  });
});

describe("checkPageFrontmatter — keys", () => {
  it("requires what the layout requires", async () => {
    expect((await check("---\ndescription: D\n---\n")).problems).toEqual([P(undefined, `"title" is required by layout "page"`)]);
  });

  it("refuses a key the layout does not declare, suggesting the one it probably meant", async () => {
    expect((await check("---\ntitel: Setup\n---\n")).problems).toEqual([
      P(2, `"titel" is not declared by layout "page": did you mean "title"?`),
      P(undefined, `"title" is required by layout "page"`),
    ]);
    expect((await check("---\ntitle: T\nlayuot: page\n---\n")).problems).toEqual([P(3, `"layuot" is not declared by layout "page": did you mean "layout"?`)]);
    expect((await check("---\ntitle: T\ncolour: red\n---\n")).problems).toEqual([P(3, `"colour" is not declared by layout "page"`)]);
  });

  it("infers nothing from the layout's sample data", async () => {
    // page.json has a `brand`; the schema does not declare it, so a page cannot set it.
    expect((await check("---\ntitle: T\nbrand: Mine\n---\n")).problems).toEqual([P(3, `"brand" is not declared by layout "page"`)]);
  });

  it("refuses the keys the storefront fills, and does not count them as missing", async () => {
    // nav is a page's own key as well, true or false (nav: false leaves the page out of the nav), so a list there is
    // that key's problem; the layout still gets the nav the storefront fills.
    expect((await check("---\ntitle: T\nbody: Mine\nnav: [a]\nsite: Mine\n---\n")).problems).toEqual([
      P(4, `nav must be true or false`), // the build's keys are checked first
      P(3, `"body" is filled by Pattern Dump, not by a page`),
      P(5, `"site" is filled by Pattern Dump, not by a page`),
    ]);
    // layouts/typed requires body: the storefront fills it, so a page without it is fine.
    expect((await check("---\nlayout: typed\ntitle: T\n---\n")).problems).toEqual([]);
  });

  it("declares nothing for a layout with no schema", async () => {
    expect((await check("---\nlayout: bare\ntitle: T\n---\n")).problems).toEqual([P(3, `"title" is not declared by layout "bare", which has no schema`)]);
    expect(await check("---\nlayout: bare\norder: 3\n---\n")).toEqual({ layoutId: "layouts/bare", layoutName: "bare", bodySlot: "body", values: {}, build: {}, problems: [], notes: [] });
  });
});

describe("checkPageFrontmatter — declared types", () => {
  it("coerces each value to its declared type", async () => {
    const md = "---\nlayout: typed\ntitle: T\ncount: 2.5\nn: -4\npinned: true\nlabels: [a, b]\nscores:\n  - 1\n  - 2.5\ntone: info\neither: 7\nfree: anything\n---\n";
    expect(await check(md)).toEqual({
      layoutId: "layouts/typed", layoutName: "typed", bodySlot: "body",
      values: { title: "T", count: 2.5, n: -4, pinned: true, labels: ["a", "b"], scores: [1, 2.5], tone: "info", either: 7, free: "anything" },
      build: {},
      problems: [],
      notes: [],
    });
  });

  it("tries a union's types in order", async () => {
    expect((await check("---\nlayout: typed\ntitle: T\neither: abc\n---\n")).values).toMatchObject({ either: "abc" });
    expect((await check("---\nlayout: typed\ntitle: T\neither: 5\n---\n")).values).toMatchObject({ either: 5 });
  });

  it("refuses a value that does not coerce, naming the key, the type and the value", async () => {
    const md = [
      "---", "layout: typed", "title: [not, text]", "count: three", "n: 2.5", "pinned: yes", "labels: a", "scores: [1, x]", "tone: danger", "---", "",
    ].join("\n");
    expect((await check(md)).problems).toEqual([
      P(3, `"title" must be text, not a list`),
      P(4, `"count" must be a number (got "three")`),
      P(5, `"n" must be a whole number (got "2.5")`),
      P(6, `"pinned" must be true or false (got "yes")`),
      P(7, `"labels" must be a list (got "a")`),
      P(8, `"scores" has an item that must be a number (got "x")`),
      P(9, `"tone" must be one of "warning", "info" (got "danger")`),
    ]);
  });

  it("keeps a value that failed out of the values passed on", async () => {
    expect((await check("---\nlayout: typed\ntitle: T\ncount: three\n---\n")).values).toEqual({ title: "T" });
  });
});

describe("checkPageFrontmatter — the build's own keys: redirectFrom, index, image", () => {
  it("reads them for the build and never passes them to the layout", async () => {
    const r = await check("---\ntitle: T\nredirectFrom: [/old/, /older/page/]\nindex: false\nimage: /assets/images/share.png\n---\n");
    expect(r.problems).toEqual([]);
    expect(r.values).toEqual({ title: "T" });
    expect(r.build).toEqual({ redirectFrom: ["/old/", "/older/page/"], index: false, image: "/assets/images/share.png", imageAs: { written: "/assets/images/share.png" } });
  });

  it("takes one old route written alone, and index: true", async () => {
    const r = await check("---\ntitle: T\nredirectFrom: /old/\nindex: true\n---\n");
    expect(r.build).toEqual({ redirectFrom: ["/old/"], index: true });
  });

  it("takes an old route that is a file ending in .html, at the root or in a folder", async () => {
    const r = await check("---\ntitle: T\nredirectFrom: [/how-to/how-to-spfx-react.html, /x.html, /old/]\n---\n");
    expect(r.problems).toEqual([]);
    expect(r.build).toEqual({ redirectFrom: ["/how-to/how-to-spfx-react.html", "/x.html", "/old/"] });
  });

  it("refuses old routes that are not root-relative, slash-wrapped plain paths, with the line", async () => {
    const r = await check("---\ntitle: T\nredirectFrom: [old/, /old, /a?b/, /a/../b/, /, //x/]\n---\n");
    expect(r.problems).toEqual([P(3, `redirectFrom: "old/", "/old", "/a?b/", "/a/../b/", "/", "//x/" are not a route: `
      + `each old route starts with "/" and ends with "/" or ".html", such as "/old/page/" or "/old/page.html", with no query or fragment`)]);
    expect(r.build).toEqual({});
  });

  it("refuses each file that isn't a plain root-relative .html path, naming both forms", async () => {
    for (const old of ["/x.htm", "/x.html?y", "/x.html#y", "/../x.html", "x.html", "/a/./x.html", "/.html"]) {
      const r = await check(`---\ntitle: T\nredirectFrom: "${old}"\n---\n`);
      expect(r.problems, old).toEqual([P(3, `redirectFrom: "${old}" is not a route: `
        + `each old route starts with "/" and ends with "/" or ".html", such as "/old/page/" or "/old/page.html", with no query or fragment`)]);
      expect(r.build, old).toEqual({});
    }
  });

  it("refuses an index that is not true or false", async () => {
    expect((await check("---\ntitle: T\nindex: no\n---\n")).problems).toEqual([P(3, "index must be true or false")]);
  });

  it("resolves a relative image against the page's folder, or the index.md whose childDefaults gave it", async () => {
    for (const [written, beside] of [["./share.png", "guides/share.png"], ["share.png", "guides/share.png"], ["../shared/share.png", "shared/share.png"]] as const) {
      const r = await check(`---\ntitle: T\nimage: ${written}\n---\n`);
      expect(r.problems, written).toEqual([]);
      expect(r.build, written).toEqual({ image: `/${beside}`, imageAs: { written, beside } });
    }
    const fromDefaults = { ...pageFile("---\ntitle: T\nimage: ./cover.png\n---\n", "guides/deep/setup.md"),
      defaults: { image: { from: "guides/index.md", line: 4 } } };
    expect((await checkPageFrontmatter(fromDefaults, map)).build.image).toBe("/guides/cover.png");
  });

  it("refuses a relative image that leaves the pages folder", async () => {
    expect((await check(`---\ntitle: T\nimage: ../../share.png\n---\n`)).problems)
      .toEqual([P(3, `image "../../share.png" is outside the pages folder: a relative image stays inside site.pagesDir`)]);
  });

  it("refuses an image that is neither a path in the assets nor one beside the page", async () => {
    for (const bad of ["/images/share.png", "https://example.com/share.png", "/assets/", "[/assets/a.png, /assets/b.png]"]) {
      expect((await check(`---\ntitle: T\nimage: ${bad}\n---\n`)).problems, bad)
        .toEqual([P(3, `image must be a path to a file in the assets, such as "/assets/images/share.png", or an image beside the page, such as "./share.png"`)]);
    }
  });

  it("refuses a layout that declares a key the build owns", async () => {
    const r = await check("---\nlayout: claims\ntitle: T\n---\n");
    expect(r.problems).toEqual([
      P(undefined, `layout "claims" declares "order", which a page sets for the build, not for its layout: rename it in the layout's schema`),
      P(undefined, `layout "claims" declares "image", which a page sets for the build, not for its layout: rename it in the layout's schema`),
    ]);
  });

  it("checks them even when the layout does not exist", async () => {
    const r = await check("---\nlayout: nope\nindex: maybe\n---\n");
    expect(r.problems).toContainEqual(P(3, "index must be true or false"));
  });
});

describe("checkPageFrontmatter — the listing keys: date, tags, draft, sort", () => {
  it("reads them for the build and never passes them to the layout", async () => {
    const r = await check("---\ntitle: T\ndate: 2026-11-02\ntags: [design, css-2]\ndraft: true\n---\n");
    expect(r.problems).toEqual([]);
    expect(r.values).toEqual({ title: "T" });
    expect(r.build).toEqual({ date: "2026-11-02", tags: ["design", "css-2"], draft: true });
  });

  it("takes one tag written alone, and draft: false", async () => {
    expect((await check("---\ntitle: T\ntags: design\ndraft: false\n---\n")).build).toEqual({ tags: ["design"], draft: false });
  });

  it("refuses a date that is not a real calendar date written YYYY-MM-DD", async () => {
    for (const bad of ["2026-13-01", "2026-02-30", "2026-2-3", "14.11.2026", "2026-02-30T10:00:00Z", "[2026-11-14]"]) {
      const shown = bad.startsWith("[") ? "[2026-11-14]" : `"${bad}"`;
      expect((await check(`---\ntitle: T\ndate: ${bad}\n---\n`)).problems, bad)
        .toEqual([P(3, `date ${shown} is not a date: write it YYYY-MM-DD, such as "2026-11-14"`)]);
    }
    expect((await check("---\ntitle: T\ndate: 2028-02-29\n---\n")).problems).toEqual([]);
  });

  it("names the day to write for a date-time or an email-style date, as written in its own offset", async () => {
    const cases: Array<[string, string]> = [
      // West of UTC: the instant is 14 November in UTC, the day as written is the 13th.
      ["2026-11-13T23:30:00-08:00", `date "2026-11-13T23:30:00-08:00" has a time: a page's date is a day, so write the day only, as written: date: 2026-11-13`],
      ["Thu, 13 Nov 2026 23:30:00 -0800", `date "Thu, 13 Nov 2026 23:30:00 -0800" is an email-style date: write the day only, YYYY-MM-DD: date: 2026-11-13`],
      // East of UTC: the instant is 13 November in UTC, the day as written is the 14th.
      ["2026-11-14T00:30:00+13:00", `date "2026-11-14T00:30:00+13:00" has a time: a page's date is a day, so write the day only, as written: date: 2026-11-14`],
      ["Sat, 14 Nov 2026 00:30:00 +1300", `date "Sat, 14 Nov 2026 00:30:00 +1300" is an email-style date: write the day only, YYYY-MM-DD: date: 2026-11-14`],
      ["2026-11-13T23:30:00Z", `date "2026-11-13T23:30:00Z" has a time: a page's date is a day, so write the day only, as written: date: 2026-11-13`],
      ["\"2026-11-13T23:30:00-08:00\"", `date "2026-11-13T23:30:00-08:00" has a time: a page's date is a day, so write the day only, as written: date: 2026-11-13`],
      ["2026-11-14T10:00", `date "2026-11-14T10:00" has a time: a page's date is a day, so write the day only, as written: date: 2026-11-14`],
      ["5 Nov 2026", `date "5 Nov 2026" is an email-style date: write the day only, YYYY-MM-DD: date: 2026-11-05`],
      ["2026-11-13 # the launch", `date "2026-11-13 # the launch": a "#" starts no comment in frontmatter, so "# the launch" is part of the value: remove it, and write the day only: date: 2026-11-13`],
    ];
    for (const [value, message] of cases) {
      expect((await check(`---\ntitle: T\ndate: ${value}\n---\n`)).problems, value).toEqual([P(3, message)]);
    }
    // A quoted date-time with a comment after it: the frontmatter's own problem (the quote isn't closed), then the date's.
    const commented = (await check("---\ntitle: T\ndate: '2026-11-13T23:30:00-08:00' ## must be today or earlier\n---\n")).problems;
    expect(commented.at(-1)).toEqual(P(3, `date "'2026-11-13T23:30:00-08:00' ## must be today or earlier": a "#" starts no comment in frontmatter, `
      + `so "## must be today or earlier" is part of the value: remove it, and write the day only: date: 2026-11-13`));
    // updated reads the same.
    expect((await check("---\ntitle: T\nupdated: Fri, 20 Nov 2026 08:00:00 +0100\n---\n")).problems).toEqual([
      P(3, `updated "Fri, 20 Nov 2026 08:00:00 +0100" is an email-style date: write the day only, YYYY-MM-DD: updated: 2026-11-20`)]);
  });

  it("says what Hugo's date keys are here", async () => {
    expect((await check("---\ntitle: T\nlastmod: 2026-11-20\npublishDate: 2026-11-01\nexpiryDate: 2027-01-01\n---\n")).problems).toEqual([
      P(3, `"lastmod" is not declared by layout "page": Hugo's lastmod is "updated" here (updated: YYYY-MM-DD, set for a real change)`),
      P(4, `"publishDate" is not declared by layout "page": Hugo's publishDate is "date" here (date: YYYY-MM-DD; a date after today keeps the page out of pd build until then)`),
      P(5, `"expiryDate" is not declared by layout "page": Hugo's expiryDate has no equivalent: a page stays until it is removed, or set draft: true`),
    ]);
  });

  it("refuses a tag that can't be a URL segment, and a tag listed twice", async () => {
    expect((await check("---\ntitle: T\ntags: [Design, ok, a b]\n---\n")).problems).toEqual([
      P(3, `tags: "Design", "a b" are not a tag: a tag is lowercase letters, digits and hyphens, such as "design-systems"`)]);
    expect((await check("---\ntitle: T\ntags: [css, html, css]\n---\n")).problems).toEqual([P(3, `tags: "css" is listed twice`)]);
  });

  it("refuses a draft that is not true or false", async () => {
    expect((await check("---\ntitle: T\ndraft: yes\n---\n")).problems).toEqual([P(3, "draft must be true or false")]);
  });

  it("takes sort on a folder's index.md, the root's too, and refuses it on a page", async () => {
    const at = (md: string, path: string) => checkPageFrontmatter(pageFile(md, path), map);
    expect((await at("---\ntitle: T\nsort: date\n---\n", "guides/index.md")).build).toEqual({ sort: "date" });
    expect((await at("---\ntitle: T\nsort: order\n---\n", "index.md")).build).toEqual({ sort: "order" });
    expect((await at("---\ntitle: T\nsort: newest\n---\n", "guides/index.md")).problems).toEqual([{ file: "guides/index.md", line: 3,
      message: `sort must be "date" (newest first) or "order" (the folder's order, the default)` }]);
    expect((await check("---\ntitle: T\nsort: date\n---\n")).problems)
      .toEqual([P(3, "sort orders a folder's pages, so it belongs on the folder's index.md, not on a page")]);
  });

  it("takes feed on a folder's index.md: false, true, or its settings indented under it; refuses it on a page", async () => {
    const at = (md: string, path = "articles/index.md") => checkPageFrontmatter(pageFile(md, path), map);
    expect((await at("---\ntitle: T\nfeed: false\n---\n")).build).toEqual({ feed: false });
    expect((await at("---\ntitle: T\nfeed: true\n---\n")).build).toEqual({ feed: {} });
    const set = await at("---\ntitle: T\nfeed:\n  limit: 50\n  path: index.xml\n  content: summary\n---\n");
    expect(set.problems).toEqual([]);
    expect(set.build).toEqual({ feed: { limit: 50, path: "index.xml" } });
    expect((await at("---\ntitle: T\nfeed:\n  atom: feed.xml\n  rss: index.xml\n---\n")).build).toEqual({ feed: { atom: "feed.xml", rss: "index.xml" } });
    const bad: Array<[string, string]> = [
      ["feed: maybe\n", "feed must be true or false, or have its settings indented under it (limit, path)"],
      ["feed:\n  limit: 0\n", "feed.limit must be a whole number of 1 or more, such as 20"],
      ["feed:\n  path: feed\n", `feed.path must be a file name ending in .xml, such as "index.xml"`],
      ["feed:\n  path: ../feed.xml\n", `feed.path must be a file name ending in .xml, such as "index.xml"`],
      ["feed:\n  limt: 5\n", `feed.limt is not a feed setting: it takes limit, path, atom, rss: did you mean "limit"?`],
      ["feed:\n  content: full\n", `feed.content "full" is not supported yet: use "summary", or leave it out`],
      ["feed:\n  path: a.xml\n  rss: b.xml\n", "feed.path names a feed in one format, feed.atom and feed.rss one in both: give one or the other"],
      ["feed:\n  rss: b.xml\n", "feed.atom and feed.rss name a feed in both formats, so give both, or feed.path for one"],
      ["feed:\n  atom: b.xml\n  rss: b.xml\n", `feed.atom and feed.rss are both "b.xml": give each a name of its own`],
    ];
    for (const [lines, message] of bad) {
      expect((await at(`---\ntitle: T\n${lines}---\n`)).problems, lines).toEqual([{ file: "articles/index.md", line: 3, message }]);
    }
    expect((await check("---\ntitle: T\nfeed: false\n---\n")).problems)
      .toEqual([P(3, "feed sets a folder's feed, so it belongs on the folder's index.md, not on a page")]);
  });

  it("refuses a layout that declares one of them", async () => {
    const r = await check("---\nlayout: listing\ntitle: T\n---\n");
    expect(r.problems).toEqual(["date", "tags", "draft", "sort"].map(k =>
      P(undefined, `layout "listing" declares "${k}", which a page sets for the build, not for its layout: rename it in the layout's schema`)));
  });
});

describe("checkPageFrontmatter — the frontmatter's own grammar", () => {
  it("reports grammar errors first, with their lines, then the key checks", async () => {
    expect((await check("---\ntitle: T\n  nested: x\ntitle: U\nwho: me\n---\n")).problems).toEqual([
      P(3, "nested value with no key above it: nested keys follow a line `key:`, indented under it"),
      P(4, `duplicate key "title"`),
      P(5, `"who" is not declared by layout "page"`),
    ]);
  });

  it("reports an unclosed block", async () => {
    expect((await check("---\ntitle: T\n")).problems).toEqual([
      P(1, "the frontmatter block opened here is never closed: end it with a line holding only ---"),
      P(undefined, `"title" is required by layout "page"`),
    ]);
  });
});

describe("checkPageFrontmatter — the storefront bench", () => {
  it("finds nothing wrong with any of its pages", async () => {
    const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
    const benchMap = (await buildDiscoveryMap(join(bench, "src", "patterns"))).discoveryMap;
    const model = await readPages(join(bench, "pages"), { categories: benchConfig.site?.categories });
    const checked = await Promise.all([...model.files.values()].map(f => checkPageFrontmatter(f, benchMap, model.categories)));
    expect(checked.flatMap(c => c.problems)).toEqual([]);
    expect(checked.map(c => c.layoutId)).toEqual(["layouts/home", "layouts/page", "layouts/doc", "layouts/doc",
      "layouts/listing", "layouts/article", "layouts/doc"]);
    expect(checked[2].values).toEqual({
      title: "Setup", description: "How the bench is put together.",
      lede: "Three folders make a site — the pages, the layouts that dress them, and the components they show.",
    });
  });
});
