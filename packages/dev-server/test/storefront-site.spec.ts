// storefront.site, checked against the `site` property partials/base's schema declares — with the same
// checker as page frontmatter, coercion off. Declared, not inferred: every way it can be wrong, with its
// exact message.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { validateConfig } from "@pattern-dump/config";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { checkSite } from "../src/storefront/site.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { readPages } from "../src/storefront/pages.js";
import { save } from "../../../test-support/save.js";

/** What these cases compare: the values and the problems (navigations have their own spec). */
const vp = (c: { values: unknown; problems: string[] }) => ({ values: c.values, problems: c.problems });

let tmp = "";
const maps: Record<string, DiscoveryMap> = {};

const FULL = {
  required: ["site"],
  properties: {
    site: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        version: { type: ["number", "string"] },
        theme: { type: "string", enum: ["light", "dark"] },
        year: { type: "integer" },
        links: { type: "array", items: { type: "string" } },
      },
    },
  },
};

/** A site that holds objects and lists of objects. */
const NESTED = {
  properties: {
    site: {
      type: "object",
      properties: {
        home: { type: "object", required: ["label"], properties: { page: { type: "string" }, label: { type: "string" } } },
        links: { type: "array", items: { type: "object", properties: { label: { type: "string" }, href: { type: "string" } } } },
        tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
        // An object with no type, by its properties alone; and one that declares nothing inside.
        meta: { properties: { note: { type: "string" } } },
        social: { type: "object" },
      },
    },
  },
};

/** One project per case: name → files under its patterns folder. */
const PROJECTS: Record<string, Record<string, string>> = {
  full: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": JSON.stringify(FULL) },
  optional: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": JSON.stringify({ properties: FULL.properties }) },
  noSchema: { "partials/base/base.hbs": "<div></div>" },
  noSite: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": JSON.stringify({ properties: { other: { type: "string" } } }) },
  broken: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": "{ not json" },
  noBase: { "layouts/page/page.hbs": "<main></main>" },
  nested: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": JSON.stringify(NESTED) },
  // A skin that lists one navigation by name, beside a value of its own.
  navs: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": JSON.stringify({ properties: { site: { type: "object", properties: {
    title: { type: "string" }, navigations: { type: "object", properties: { footer: { description: "At the foot of every page" } } },
  } } } }) },
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-site-"));
  for (const [name, files] of Object.entries(PROJECTS)) {
    for (const [path, body] of Object.entries(files)) {
      const file = join(tmp, name, ...path.split("/"));
      await mkdir(dirname(file), { recursive: true });
      await save(file, body);
    }
    maps[name] = (await buildDiscoveryMap(join(tmp, name))).discoveryMap;
  }
});

afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("checkSite — values partials/base declares", () => {
  it("passes declared values through as they are", async () => {
    const site = { title: "Docs", version: 2, theme: "dark", year: 2026, links: ["a", "b"] };
    expect(vp(await checkSite(site, maps.full))).toEqual({ values: site, problems: [] });
  });

  it("tries a union's types in order", async () => {
    expect((await checkSite({ title: "Docs", version: "beta" }, maps.full)).problems).toEqual([]);
    expect((await checkSite({ title: "Docs", version: 3 }, maps.full)).problems).toEqual([]);
    expect((await checkSite({ title: "Docs", version: true }, maps.full)).problems).toEqual(["storefront.site.version must be a number (got true)"]);
  });

  it("checks an enum", async () => {
    expect((await checkSite({ title: "Docs", theme: "sepia" }, maps.full)).problems).toEqual([`storefront.site.theme must be one of "light", "dark" (got "sepia")`]);
  });

  it("coerces nothing: a config value must already be its declared type", async () => {
    expect((await checkSite({ title: 7, year: "2026", links: "a" }, maps.full)).problems).toEqual([
      "storefront.site.title must be text (got 7)",
      `storefront.site.year must be a whole number (got "2026")`,
      `storefront.site.links must be a list (got "a")`,
    ]);
  });

  it("refuses a key it does not declare, suggesting the one probably meant, and requires what it requires", async () => {
    expect(vp(await checkSite({ titel: "Docs", colour: "red" }, maps.full))).toEqual({
      values: {},
      problems: [
        `storefront.site.titel is not declared by partials/base — did you mean "title"?`,
        "storefront.site.colour is not declared by partials/base",
        "storefront.site.title is required by partials/base",
      ],
    });
  });
});

describe("checkSite — inside objects and lists", () => {
  const check = async (site: Record<string, unknown>) => (await checkSite(site, maps.nested)).problems;

  it("checks a nested value's type, with its path", async () => {
    expect(await check({ home: { page: 5, label: "Home" } })).toEqual(["storefront.site.home.page must be text (got 5)"]);
  });

  it("refuses a nested key it does not declare, suggesting the one probably meant", async () => {
    expect(await check({ home: { pgae: "/", label: "Home" } }))
      .toEqual([`storefront.site.home.pgae is not declared by partials/base — did you mean "page"?`]);
  });

  it("requires a nested key the schema requires", async () => {
    expect(await check({ home: { page: "/" } })).toEqual(["storefront.site.home.label is required by partials/base"]);
  });

  it("checks every item of a list, with its index", async () => {
    expect(await check({ links: [{ label: "A", href: "/a" }, { label: 2, href: "/b" }], tags: ["a", "c"] })).toEqual([
      "storefront.site.links[1].label must be text (got 2)",
      `storefront.site.tags[1] must be one of "a", "b" (got "c")`,
    ]);
    expect(await check({ links: ["/a"] })).toEqual([`storefront.site.links[0] must be an object (got "/a")`]);
  });

  it("reports every problem, not only the first", async () => {
    const r = await checkSite({ home: { page: 5 }, links: [{ label: 2 }, { lable: "x" }], meta: { note: 1 }, titel: "x" }, maps.nested);
    expect(vp(r)).toEqual({
      values: {},
      problems: [
        "storefront.site.home.page must be text (got 5)",
        "storefront.site.home.label is required by partials/base",
        "storefront.site.links[0].label must be text (got 2)",
        `storefront.site.links[1].lable is not declared by partials/base — did you mean "label"?`,
        "storefront.site.meta.note must be text (got 1)",
        "storefront.site.titel is not declared by partials/base",
      ],
    });
  });

  it("passes nested values through as they are, and takes an object that declares nothing inside as closed", async () => {
    const site = { home: { page: "/", label: "Home" }, links: [{ label: "A", href: "/a" }], tags: ["b"], meta: { note: "n" }, social: {} };
    expect(vp(await checkSite(site, maps.nested))).toEqual({ values: site, problems: [] });
    expect(await check({ social: { x: "@pd" } })).toEqual(["storefront.site.social.x is not declared by partials/base"]);
  });
});

describe("checkSite — navigations", () => {
  const PAGES = new Set(["index.md", "about.md"]);

  it("takes navigations apart from the other values, checked by their own shape", async () => {
    const r = await checkSite({ title: "Docs", navigations: { footer: [{ page: "about.md" }] } }, maps.navs!, PAGES);
    expect(r).toEqual({ values: { title: "Docs" }, navigations: { footer: [{ page: "about.md" }] }, listed: ["footer"], collections: [], problems: [], notes: [] });
  });

  it("reports a navigation's problem once, by its own check, beside the other values' problems", async () => {
    expect((await checkSite({ title: 3, navigations: { footer: [{ page: 5 }], legal: [] } }, maps.navs!, PAGES)).problems).toEqual([
      "storefront.site.title must be text (got 3)",
      `storefront.site.navigations.footer[0].page must be the path of a page in the pages folder, such as "about.md" (got 5)`,
      `storefront.site.navigations.legal is not a navigation partials/base lists (it lists "footer")`,
    ]);
  });

  it("lists the skin's navigations even when the config sets none", async () => {
    expect(await checkSite({ title: "Docs" }, maps.navs!, PAGES)).toMatchObject({ navigations: {}, listed: ["footer"], problems: [] });
  });
});

describe("checkSite — when there is nothing to check against", () => {
  it("requires storefront.site when partials/base requires a site", async () => {
    expect(vp(await checkSite(undefined, maps.full))).toEqual({ values: {}, problems: ["storefront.site is required by partials/base"] });
    expect(vp(await checkSite(undefined, maps.optional))).toEqual({ values: {}, problems: [] });
  });

  it("refuses a site that nothing declares", async () => {
    expect((await checkSite({ title: "Docs" }, maps.noSchema)).problems).toEqual(["storefront.site is set, but partials/base declares no site, so no layout can use it"]);
    expect((await checkSite({ title: "Docs" }, maps.noSite)).problems).toEqual(["storefront.site is set, but partials/base declares no site, so no layout can use it"]);
    expect((await checkSite({ title: "Docs" }, maps.noBase)).problems).toEqual(["storefront.site is set, but there is no partials/base to declare what it holds"]);
  });

  it("is fine with no site where none is declared", async () => {
    for (const name of ["noSchema", "noSite", "noBase"]) expect(vp(await checkSite(undefined, maps[name])), name).toEqual({ values: {}, problems: [] });
  });

  it("reports a schema it cannot read", async () => {
    const r = await checkSite({ title: "Docs" }, maps.broken);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/^the schema of partials\/base cannot be read: /);
  });
});

describe("checkSite — the storefront bench", () => {
  it("accepts the bench's site against its partials/base", async () => {
    const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
    const map = (await buildDiscoveryMap(join(bench, "src", "patterns"))).discoveryMap;
    const site = validateConfig(benchConfig, "storefront-bench").storefront?.site;
    const pages = new Set([...(await readPages(join(bench, "pages"))).files.values()].map(f => f.path));
    const r = await checkSite(site, map, pages);
    expect(vp(r)).toEqual({
      values: { title: "Storefront bench", tagline: "A website written in markdown", href: "/", year: "2026", footer: "Built with Pattern Dump from the storefront bench." },
      problems: [],
    });
    expect(r.listed).toEqual(["footer"]);
    expect(Object.keys(r.navigations)).toEqual(["footer"]);
  });
});
