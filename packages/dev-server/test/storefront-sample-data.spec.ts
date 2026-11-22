// A site page renders without sample data: a layout's, every partial's in its include tree, however deep, and a
// placed component's (renderer: RenderInput.sampleData). So a sample may set any key, and none of it reaches a page;
// the workbench still previews each component with its sample data. Before, a sample key outside what a page's
// context carries failed every page using the layout (SFP-105), and a partial inside {{#each}} could still leak a key
// the layout declares, since it renders with an item as its context.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry, includeTree, type CompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage } from "../src/storefront/page.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sample-data-")); });

/** The bench's shape: layouts/page wraps partials/base (a block include), which includes partials/header; the page's
 *  items are each shown by partials/item. */
const BASE_FILES: Record<string, string> = {
  "layouts/page/page.hbs": "{{#> partials-base }}<h1>{{title}}</h1><p class=\"kicker\">{{kicker}}</p>{{{body}}}"
    + "<ul>{{#each items}}{{> partials-item }}{{/each}}</ul>{{/partials-base}}",
  "layouts/page/page.schema.json": JSON.stringify({ required: ["title"], properties: {
    title: { type: "string" }, kicker: { type: "string" }, items: { type: "array", items: { type: "string" } },
  } }),
  "partials/base/base.hbs": "<div>{{> partials-header }}{{> @partial-block }}</div>",
  "partials/base/base.schema.json": JSON.stringify({ properties: { site: { type: "object", properties: { title: { type: "string" } } } } }),
  "partials/header/header.hbs": "<header>{{site.title}}{{logo}}{{site.tagline}}</header>",
  "partials/item/item.hbs": "<li>item{{label}}{{kicker}}</li>",
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

/** The home page, assembled with the project's layout; `frontmatter` adds to its front matter. */
async function home(p: Awaited<ReturnType<typeof project>>, frontmatter = "") {
  const pagesDir = join(p.dir, "..", `pages-${n++}`);
  await mkdir(pagesDir, { recursive: true });
  await save(join(pagesDir, "index.md"), `---\ntitle: Home\n${frontmatter}---\nHello.\n`);
  return assemblePage("/", await readPages(pagesDir), {
    discoveryMap: p.map, composition: p.composition, site: undefined, workbenchUrl: "https://wb.example/",
    render: createRenderer({ patternsDir: p.dir, discoveryMap: p.map, handleMap: p.handleMap }),
    head: async () => "",
  });
}

const SAMPLES: Record<string, string> = {
  "layouts/page/page.json": JSON.stringify({ title: "SAMPLE-TITLE", kicker: "SAMPLE-LAYOUT-KICKER", banner: "SAMPLE-BANNER",
    site: { title: "SAMPLE-SITE", tagline: "SAMPLE-TAGLINE" }, page: { foo: "SAMPLE-PAGE" } }),
  "partials/base/base.json": JSON.stringify({ promo: "SAMPLE-PROMO" }),
  "partials/header/header.json": JSON.stringify({ logo: "SAMPLE-LOGO", site: { tagline: "SAMPLE-HEADER-TAGLINE" } }),
  // Named like a key the layout declares: inside {{#each}} its context is an item, which has no kicker.
  "partials/item/item.json": JSON.stringify({ label: "SAMPLE-LABEL", kicker: "SAMPLE-ITEM-KICKER" }),
};

describe("sample data and a site page", () => {
  it("sees the whole include tree, block includes and nested partials alike", async () => {
    const p = await project({});
    expect(includeTree("layouts/page", p.composition)).toEqual(["layouts/page", "partials/base", "partials/header", "partials/item"]);
  });

  it("renders the page, and no sample value reaches it: the layout's, a partial's, a nested one's, one in {{#each}}", async () => {
    const page = await home(await project(SAMPLES), "items:\n  - one\n  - two\n");
    expect(page.problems).toEqual([]);
    expect(page.status).toBe(200);
    expect(page.html).toContain("<h1>Home</h1>");
    expect(page.html).toContain("<ul><li>item</li><li>item</li></ul>");
    expect(page.html.match(/SAMPLE-[A-Z-]+/g) ?? []).toEqual([]);
  });

  // The old check let this one through: kicker is the layout's key, but inside {{#each}} the partial's context is an
  // item, so the sample's kicker showed on every item.
  it("a partial in {{#each}} whose sample sets a key the layout declares: not on the page", async () => {
    const page = await home(await project({ "partials/item/item.json": JSON.stringify({ kicker: "SAMPLE-ITEM-KICKER" }) }), "kicker: Real\nitems:\n  - one\n");
    expect(page.problems).toEqual([]);
    expect(page.html).toContain(`<p class="kicker">Real</p>`);
    expect(page.html).toContain("<ul><li>item</li></ul>");
  });

  it("the workbench still shows each component with its sample data", async () => {
    const p = await project(SAMPLES);
    const render = createRenderer({ patternsDir: p.dir, discoveryMap: p.map, handleMap: p.handleMap });
    expect((await render({ component: "partials/header" })).html).toContain("SAMPLE-LOGO");
    expect((await render({ component: "partials/item" })).html).toBe("<li>itemSAMPLE-LABELSAMPLE-ITEM-KICKER</li>");
    expect((await render({ component: "layouts/page" })).html).toContain("SAMPLE-LAYOUT-KICKER");
  });
});
