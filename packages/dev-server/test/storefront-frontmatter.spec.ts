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
  it("lists the base components directly under layouts/, not variants or partials", () => {
    expect(layoutNames(map)).toEqual(["bare", "broken", "claims", "listing", "page", "typed"]);
  });
});

describe("checkPageFrontmatter — a valid page", () => {
  it("uses the page layout when none is named, and passes the declared values on, without layout or order", async () => {
    expect(await check("---\ntitle: Setup\ndescription: How\norder: 2\n---\n")).toEqual({
      layoutId: "layouts/page", values: { title: "Setup", description: "How" }, build: {}, problems: [],
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
      expect((await check(`---\ntitle: T\nlayout: ${value}\n---\n`)).problems).toEqual([P(3, `layout "${value}" is not a layout — ${known}`)]);
    });
  }

  it("refuses a list", async () => {
    expect((await check("---\nlayout: [page, typed]\ntitle: T\n---\n")).problems).toEqual([P(2, "layout must be one layout name, not a list")]);
  });

  it("says so when the project has no layouts at all", async () => {
    expect((await check("---\ntitle: T\n---\n", new Map())).problems).toEqual([
      P(undefined, `layout "page" is not a layout — the project has no layouts (components in a layouts/ folder of its patterns)`),
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
      P(2, `"titel" is not declared by layout "page" — did you mean "title"?`),
      P(undefined, `"title" is required by layout "page"`),
    ]);
    expect((await check("---\ntitle: T\nlayuot: page\n---\n")).problems).toEqual([P(3, `"layuot" is not declared by layout "page" — did you mean "layout"?`)]);
    expect((await check("---\ntitle: T\ncolour: red\n---\n")).problems).toEqual([P(3, `"colour" is not declared by layout "page"`)]);
  });

  it("infers nothing from the layout's sample data", async () => {
    // page.json has a `brand`; the schema does not declare it, so a page cannot set it.
    expect((await check("---\ntitle: T\nbrand: Mine\n---\n")).problems).toEqual([P(3, `"brand" is not declared by layout "page"`)]);
  });

  it("refuses the keys the storefront fills, and does not count them as missing", async () => {
    expect((await check("---\ntitle: T\nbody: Mine\nnav: [a]\nsite: Mine\n---\n")).problems).toEqual([
      P(3, `"body" is filled by the storefront, not by a page`),
      P(4, `"nav" is filled by the storefront, not by a page`),
      P(5, `"site" is filled by the storefront, not by a page`),
    ]);
    // layouts/typed requires body: the storefront fills it, so a page without it is fine.
    expect((await check("---\nlayout: typed\ntitle: T\n---\n")).problems).toEqual([]);
  });

  it("declares nothing for a layout with no schema", async () => {
    expect((await check("---\nlayout: bare\ntitle: T\n---\n")).problems).toEqual([P(3, `"title" is not declared by layout "bare", which has no schema`)]);
    expect(await check("---\nlayout: bare\norder: 3\n---\n")).toEqual({ layoutId: "layouts/bare", values: {}, build: {}, problems: [] });
  });
});

describe("checkPageFrontmatter — declared types", () => {
  it("coerces each value to its declared type", async () => {
    const md = "---\nlayout: typed\ntitle: T\ncount: 2.5\nn: -4\npinned: true\nlabels: [a, b]\nscores:\n  - 1\n  - 2.5\ntone: info\neither: 7\nfree: anything\n---\n";
    expect(await check(md)).toEqual({
      layoutId: "layouts/typed",
      values: { title: "T", count: 2.5, n: -4, pinned: true, labels: ["a", "b"], scores: [1, 2.5], tone: "info", either: 7, free: "anything" },
      build: {},
      problems: [],
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
    expect(r.build).toEqual({ redirectFrom: ["/old/", "/older/page/"], index: false, image: "/assets/images/share.png" });
  });

  it("takes one old route written alone, and index: true", async () => {
    const r = await check("---\ntitle: T\nredirectFrom: /old/\nindex: true\n---\n");
    expect(r.build).toEqual({ redirectFrom: ["/old/"], index: true });
  });

  it("refuses old routes that are not root-relative, slash-wrapped plain paths, with the line", async () => {
    const r = await check("---\ntitle: T\nredirectFrom: [old/, /old, /a?b/, /a/../b/, /, //x/]\n---\n");
    expect(r.problems).toEqual([P(3, `redirectFrom: "old/", "/old", "/a?b/", "/a/../b/", "/", "//x/" are not a route: `
      + `each old route starts and ends with "/", such as "/old/page/", with no query or fragment`)]);
    expect(r.build).toEqual({});
  });

  it("refuses an index that is not true or false", async () => {
    expect((await check("---\ntitle: T\nindex: no\n---\n")).problems).toEqual([P(3, "index must be true or false")]);
  });

  it("refuses an image that is not a path in the assets", async () => {
    for (const bad of ["images/share.png", "/images/share.png", "https://example.com/share.png", "/assets/", "[/assets/a.png, /assets/b.png]"]) {
      expect((await check(`---\ntitle: T\nimage: ${bad}\n---\n`)).problems, bad)
        .toEqual([P(3, `image must be a path to a file in the assets, such as "/assets/images/share.png"`)]);
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
    for (const bad of ["2026-13-01", "2026-02-30", "2026-2-3", "14.11.2026", "2026-11-14T10:00", "[2026-11-14]"]) {
      const shown = bad.startsWith("[") ? "[2026-11-14]" : `"${bad}"`;
      expect((await check(`---\ntitle: T\ndate: ${bad}\n---\n`)).problems, bad)
        .toEqual([P(3, `date ${shown} is not a date: write it YYYY-MM-DD, such as "2026-11-14"`)]);
    }
    expect((await check("---\ntitle: T\ndate: 2028-02-29\n---\n")).problems).toEqual([]);
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

  it("refuses a layout that declares one of them", async () => {
    const r = await check("---\nlayout: listing\ntitle: T\n---\n");
    expect(r.problems).toEqual(["date", "tags", "draft", "sort"].map(k =>
      P(undefined, `layout "listing" declares "${k}", which a page sets for the build, not for its layout: rename it in the layout's schema`)));
  });
});

describe("checkPageFrontmatter — the frontmatter's own grammar", () => {
  it("reports grammar errors first, with their lines, then the key checks", async () => {
    expect((await check("---\ntitle: T\n  nested: x\ntitle: U\nwho: me\n---\n")).problems).toEqual([
      P(3, "nested value — only top-level keys are supported, written at the start of the line"),
      P(4, `duplicate key "title"`),
      P(5, `"who" is not declared by layout "page"`),
    ]);
  });

  it("reports an unclosed block", async () => {
    expect((await check("---\ntitle: T\n")).problems).toEqual([
      P(1, "the frontmatter block opened here is never closed — end it with a line holding only ---"),
      P(undefined, `"title" is required by layout "page"`),
    ]);
  });
});

describe("checkPageFrontmatter — the storefront bench", () => {
  it("finds nothing wrong with any of its pages", async () => {
    const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
    const benchMap = (await buildDiscoveryMap(join(bench, "src", "patterns"))).discoveryMap;
    const model = await readPages(join(bench, "pages"));
    const checked = await Promise.all([...model.files.values()].map(f => checkPageFrontmatter(f, benchMap)));
    expect(checked.flatMap(c => c.problems)).toEqual([]);
    expect(checked.map(c => c.layoutId)).toEqual(["layouts/home", "layouts/page", "layouts/doc", "layouts/doc"]);
    expect(checked[2].values).toEqual({
      title: "Setup", description: "How the bench is put together.",
      lede: "Three folders make a site — the pages, the layouts that dress them, and the components they show.",
    });
  });
});
