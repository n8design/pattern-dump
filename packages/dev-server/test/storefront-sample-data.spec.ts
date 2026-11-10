// A layout's sample data, and that of every partial in its include tree, may only use the keys a real
// page's context carries: what the layout declares, plus body, nav and site — and, inside site, what
// partials/base declares for it. Anything else would render on every page using the layout, so it is a
// fatal problem.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry, type CompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage } from "../src/storefront/page.js";
import { checkSampleData } from "../src/storefront/sample-data.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sample-data-")); });

/** The bench's shape: layouts/page wraps partials/base (a block include), which includes partials/header. */
const BASE_FILES: Record<string, string> = {
  "layouts/page/page.hbs": "{{#> partials-base }}<h1>{{title}}</h1>{{{body}}}{{/partials-base}}",
  "layouts/page/page.schema.json": JSON.stringify({ required: ["title"], properties: { title: { type: "string" }, kicker: { type: "string" } } }),
  "partials/base/base.hbs": "<div>{{> partials-header }}{{> @partial-block }}</div>",
  "partials/base/base.schema.json": JSON.stringify({ properties: { site: { type: "object", properties: { title: { type: "string" } } } } }),
  "partials/header/header.hbs": "<header>{{site.title}}</header>",
};

let n = 0;
async function project(extra: Record<string, string>): Promise<{ dir: string; map: DiscoveryMap; composition: CompositionRegistry; handleMap: Map<string, string> }> {
  const dir = join(tmp, `p${n++}`);
  for (const [path, body] of Object.entries({ ...BASE_FILES, ...extra })) {
    const file = join(dir, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await save(file, body);
  }
  const { discoveryMap, handleMap } = await buildDiscoveryMap(dir);
  return { dir, map: discoveryMap, handleMap, composition: await buildCompositionRegistry(dir, handleMap, discoveryMap) };
}
const check = async (extra: Record<string, string>) => {
  const p = await project(extra);
  return checkSampleData("layouts/page", p.map, p.composition, ["title", "kicker"], ["title"]);
};

describe("checkSampleData", () => {
  it("sees the whole include tree, block includes and nested partials alike", async () => {
    const p = await project({});
    expect(p.composition.uses.get("layouts/page")).toEqual(["partials/base"]);
    expect(p.composition.uses.get("partials/base")).toEqual(["partials/header"]);
  });

  it("accepts sample data that uses declared keys and the storefront's own", async () => {
    expect(await check({
      "layouts/page/page.json": JSON.stringify({ title: "T", kicker: "K", body: "<p>b</p>", nav: [{ route: "/", title: "Home" }], site: { title: "S" } }),
      "partials/base/base.json": JSON.stringify({ site: { title: "S" }, nav: [] }),
      "partials/header/header.json": JSON.stringify({ site: { title: "S" } }),
    })).toEqual([]);
  });

  it("refuses an undeclared key in the layout's own sample data", async () => {
    expect(await check({ "layouts/page/page.json": JSON.stringify({ title: "T", banner: "Sale" }) })).toEqual([
      `the sample data of layouts/page (page.json) sets "banner", which layouts/page does not declare, so it would show on every page using that layout`,
    ]);
  });

  it("refuses one in a partial the layout includes", async () => {
    expect(await check({ "partials/base/base.json": JSON.stringify({ promo: "Hi" }) })).toEqual([
      `the sample data of partials/base (base.json) sets "promo", which layouts/page does not declare, so it would show on every page using that layout`,
    ]);
  });

  it("refuses one in a partial included by a partial", async () => {
    expect(await check({ "partials/header/header.json": JSON.stringify({ logo: "x.svg" }) })).toEqual([
      `the sample data of partials/header (header.json) sets "logo", which layouts/page does not declare, so it would show on every page using that layout`,
    ]);
  });

  it("refuses a site key partials/base does not declare, at any depth", async () => {
    expect(await check({
      "layouts/page/page.json": JSON.stringify({ title: "T", site: { title: "S", tagline: "Sample" } }),
      "partials/header/header.json": JSON.stringify({ site: { motto: "Sample" } }),
    })).toEqual([
      `the sample data of layouts/page (page.json) sets "site.tagline", which partials/base does not declare for site, so it would show on every page using layouts/page`,
      `the sample data of partials/header (header.json) sets "site.motto", which partials/base does not declare for site, so it would show on every page using layouts/page`,
    ]);
  });

  describe("page: what the layout declares, inside the shape Pattern Dump fills, at every depth", () => {
    /** `pageDeclared` null: the layout does not declare page. */
    const checkPage = async (json: unknown, pageDeclared: string[] | null = ["prev", "headings"]) => {
      const p = await project({ "layouts/page/page.json": JSON.stringify(json) });
      return checkSampleData("layouts/page", p.map, p.composition, ["title", "kicker"], ["title"], pageDeclared ?? undefined);
    };
    const outside = (key: string) =>
      `the sample data of layouts/page (page.json) sets "${key}", which is not part of the page data Pattern Dump fills, so it would show on every page using layouts/page`;

    it("refuses page.foo and page.prev.extra, and accepts page.prev.title", async () => {
      expect(await checkPage({ page: { foo: "LEAKED-SAMPLE", prev: { title: "T", extra: "LEAKED-NESTED" } } }))
        .toEqual([outside("page.foo"), outside("page.prev.extra")]);
      expect(await checkPage({ page: { prev: { route: "/a/", title: "T" } } })).toEqual([]);
    });

    it("refuses a key inside a list's items", async () => {
      expect(await checkPage({ page: { headings: [{ level: 2, text: "A", anchor: "a" }, { level: 2, text: "B", anchor: "b", extra: 1 }] } }))
        .toEqual([outside("page.headings[1].extra")]);
    });

    it("refuses a sub-key of the shape the layout does not declare", async () => {
      expect(await checkPage({ page: { next: { title: "T" } } })).toEqual([
        `the sample data of layouts/page (page.json) sets "page.next", which layouts/page does not declare for page, so it would show on every page using that layout`,
      ]);
    });

    it("refuses page in a layout that does not declare it", async () => {
      expect(await checkPage({ page: { prev: { title: "T" } } }, null)).toEqual([
        `the sample data of layouts/page (page.json) sets "page", which layouts/page does not declare, so it would show on every page using that layout`,
      ]);
    });

    it("checks a partial's sample page as well", async () => {
      const p = await project({ "partials/header/header.json": JSON.stringify({ page: { prev: { extra: 1 } } }) });
      expect(await checkSampleData("layouts/page", p.map, p.composition, ["title"], ["title"], ["prev"])).toEqual([
        `the sample data of partials/header (header.json) sets "page.prev.extra", which is not part of the page data Pattern Dump fills, so it would show on every page using layouts/page`,
      ]);
    });
  });

  it("reports sample data that cannot be read", async () => {
    const problems = await check({ "partials/header/header.json": "{ not json" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^the sample data of partials\/header \(header\.json\) cannot be read: /);
  });

  it("does not check a variant's data: a page never renders a variant", async () => {
    expect(await check({ "layouts/page/page~promo.json": JSON.stringify({ banner: "Sale" }) })).toEqual([]);
  });

  it("finds nothing wrong in the storefront bench", async () => {
    const patterns = fileURLToPath(new URL("../../../storefront-bench/src/patterns/", import.meta.url));
    const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
    const composition = await buildCompositionRegistry(patterns, handleMap, discoveryMap);
    expect(await checkSampleData("layouts/page", discoveryMap, composition, ["title", "description"], ["title", "tagline", "href", "footer", "year"])).toEqual([]);
    expect(await checkSampleData("layouts/article", discoveryMap, composition, ["title", "description", "lede"], ["title", "tagline", "href", "footer", "year"])).toEqual([]);
  });
});

describe("assemblePage — a sample-data problem is fatal", () => {
  it("refuses to render a page whose layout's include tree has undeclared sample keys", async () => {
    const p = await project({ "partials/header/header.json": JSON.stringify({ logo: "x.svg" }) });
    const pagesDir = join(p.dir, "..", `pages-${n++}`);
    await mkdir(pagesDir, { recursive: true });
    await save(join(pagesDir, "index.md"), "---\ntitle: Home\n---\nHello.\n");
    const page = await assemblePage("/", await readPages(pagesDir), {
      discoveryMap: p.map, composition: p.composition, site: undefined, workbenchUrl: "https://wb.example/",
      render: createRenderer({ patternsDir: p.dir, discoveryMap: p.map, handleMap: p.handleMap }),
      head: async () => "",
    });
    expect(page.status).toBe(500);
    expect(page.problems).toEqual([
      `the sample data of partials/header (header.json) sets "logo", which layouts/page does not declare, so it would show on every page using that layout`,
    ]);
    expect(page.html).not.toContain("x.svg");
  });
});
