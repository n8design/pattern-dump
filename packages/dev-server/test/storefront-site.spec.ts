// storefront.site, checked against the `site` property partials/base's schema declares — with the same
// checker as page frontmatter, coercion off. Declared, not inferred: every way it can be wrong, with its
// exact message.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { validateConfig } from "@pattern-dump/config";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { checkSite } from "../src/storefront/site.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

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

/** One project per case: name → files under its patterns folder. */
const PROJECTS: Record<string, Record<string, string>> = {
  full: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": JSON.stringify(FULL) },
  optional: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": JSON.stringify({ properties: FULL.properties }) },
  noSchema: { "partials/base/base.hbs": "<div></div>" },
  noSite: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": JSON.stringify({ properties: { other: { type: "string" } } }) },
  broken: { "partials/base/base.hbs": "<div></div>", "partials/base/base.schema.json": "{ not json" },
  noBase: { "layouts/page/page.hbs": "<main></main>" },
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-site-"));
  for (const [name, files] of Object.entries(PROJECTS)) {
    for (const [path, body] of Object.entries(files)) {
      const file = join(tmp, name, ...path.split("/"));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
    }
    maps[name] = (await buildDiscoveryMap(join(tmp, name))).discoveryMap;
  }
});

afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("checkSite — values partials/base declares", () => {
  it("passes declared values through as they are", async () => {
    const site = { title: "Docs", version: 2, theme: "dark", year: 2026, links: ["a", "b"] };
    expect(await checkSite(site, maps.full)).toEqual({ values: site, problems: [] });
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
    expect(await checkSite({ titel: "Docs", colour: "red" }, maps.full)).toEqual({
      values: {},
      problems: [
        `storefront.site.titel is not declared by partials/base — did you mean "title"?`,
        "storefront.site.colour is not declared by partials/base",
        "storefront.site.title is required by partials/base",
      ],
    });
  });
});

describe("checkSite — when there is nothing to check against", () => {
  it("requires storefront.site when partials/base requires a site", async () => {
    expect(await checkSite(undefined, maps.full)).toEqual({ values: {}, problems: ["storefront.site is required by partials/base"] });
    expect(await checkSite(undefined, maps.optional)).toEqual({ values: {}, problems: [] });
  });

  it("refuses a site that nothing declares", async () => {
    expect((await checkSite({ title: "Docs" }, maps.noSchema)).problems).toEqual(["storefront.site is set, but partials/base declares no site, so no layout can use it"]);
    expect((await checkSite({ title: "Docs" }, maps.noSite)).problems).toEqual(["storefront.site is set, but partials/base declares no site, so no layout can use it"]);
    expect((await checkSite({ title: "Docs" }, maps.noBase)).problems).toEqual(["storefront.site is set, but there is no partials/base to declare what it holds"]);
  });

  it("is fine with no site where none is declared", async () => {
    for (const name of ["noSchema", "noSite", "noBase"]) expect(await checkSite(undefined, maps[name]), name).toEqual({ values: {}, problems: [] });
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
    expect(await checkSite(site, map)).toEqual({
      values: { title: "Storefront bench", tagline: "A website written in markdown", href: "/", footer: "Built with Pattern Dump from the storefront bench." },
      problems: [],
    });
  });
});
