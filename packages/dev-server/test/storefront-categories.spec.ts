// Categories (categories.ts, listing-keys.ts readCategories): a page's reserved `categories:` names categories the
// config declares (storefront.categories), independent of its folder. An undeclared value fails the page, with a
// "did you mean"; an old key (an alias) builds as the category it now is, with a warning naming the page. Layouts get
// page.categories, listing entries carry them, and site.categories is every declared one, when partials/base lists it.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorefrontCategory } from "@pattern-dump/config";
import type { RenderInput } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { readPages } from "../src/storefront/pages.js";
import { buildCompositionRegistry } from "../src/composition.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

const CATEGORIES: Record<string, StorefrontCategory> = {
  "design-systems": { label: "Design systems", description: "How they are built", aliases: ["ds"] },
  guides: { label: "Guides" },
};
const DS = { key: "design-systems", label: "Design systems", description: "How they are built" };
const GUIDES = { key: "guides", label: "Guides", description: null };

const page = (title: string, extra = ""): string => `---\ntitle: ${title}\n${extra}---\n\nBody of ${title}.\n`;

/** A project whose layout declares `page` with `declared` and whose base declares `base`; assembles `route`. */
async function assemble(route: string, files: Record<string, string>, o: {
  declared?: string[]; base?: unknown; site?: Record<string, unknown>; categories?: Record<string, StorefrontCategory> | undefined;
  extra?: Partial<PageAssembly>;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "pd-categories-"));
  roots.push(root);
  const patterns = join(root, "patterns");
  const props = Object.fromEntries((o.declared ?? []).map(k => [k, {}]));
  for (const [rel, body] of Object.entries({
    "layouts/page/page.hbs": "{{#> partials-base}}<main><h1>{{title}}</h1>{{{body}}}<ul>{{#each page.categories}}<li>{{label}}</li>{{/each}}</ul></main>{{/partials-base}}",
    "layouts/page/page.schema.json": JSON.stringify({ properties: { title: { type: "string" }, page: { type: "object", properties: props } } }),
    "partials/base/base.hbs": "<div>{{> @partial-block}}<ol>{{#each site.categories}}<li>{{key}}</li>{{/each}}</ol></div>",
    "partials/base/base.schema.json": JSON.stringify(o.base ?? {}),
  })) await save(join(patterns, ...rel.split("/")), body);
  for (const [rel, body] of Object.entries(files)) await save(join(root, "pages", ...rel.split("/")), body);
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
  const inputs: RenderInput[] = [];
  const model = await readPages(join(root, "pages"), { categories: "categories" in o ? o.categories : CATEGORIES });
  const p = await assemblePage(route, model, {
    discoveryMap, handleMap, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap),
    site: o.site, workbenchUrl: "https://wb.example/", shown: x => x, head: async () => "",
    image: async () => ({ ok: false, message: "no images here" }),
    render: input => { inputs.push(input); return render(input); }, ...o.extra,
  } as PageAssembly);
  const data = inputs.at(-1)?.data as { page?: Record<string, unknown>; site?: Record<string, unknown> } | undefined;
  return { page: p, data: data?.page, site: data?.site, model };
}

describe("a page's categories", () => {
  it("are the declared categories it names, in its order, with key, label and description", async () => {
    const { page: p, data } = await assemble("/", { "index.md": page("Home", "categories: [guides, design-systems]\n") }, { declared: ["categories"] });
    expect(p.problems).toEqual([]);
    expect(data).toEqual({ categories: [GUIDES, DS] });
    expect(p.html).toContain("<ul><li>Guides</li><li>Design systems</li></ul>");
  });

  it("take one value as a list of one, and are [] for a page with none", async () => {
    expect((await assemble("/", { "index.md": page("Home", "categories: guides\n") }, { declared: ["categories"] })).data).toEqual({ categories: [GUIDES] });
    expect((await assemble("/", { "index.md": page("Home") }, { declared: ["categories"] })).data).toEqual({ categories: [] });
  });

  it("fail the page on an undeclared value, with a did-you-mean, else the declared keys", async () => {
    const typo = await assemble("/", { "index.md": page("Home", "categories: [guide]\n") });
    expect(typo.page.status).toBe(500);
    expect(typo.page.problems).toEqual([`index.md:3: categories: "guide" is not a category: did you mean "guides"?`]);
    const far = await assemble("/", { "index.md": page("Home", "categories: [cooking]\n") });
    expect(far.page.problems).toEqual([`index.md:3: categories: "cooking" is not a category: the categories are "design-systems", "guides" (storefront.categories)`]);
  });

  it("fail the page when the config declares none", async () => {
    const { page: p } = await assemble("/", { "index.md": page("Home", "categories: [guides]\n") }, { categories: undefined });
    expect(p.problems).toEqual([`index.md:3: categories: "guides" is not a category: the site declares none (storefront.categories in the config)`]);
  });

  it("fail the page on a value that is not a key, and on one listed twice, an old key included", async () => {
    const bad = await assemble("/", { "index.md": page("Home", "categories: [Guides]\n") });
    expect(bad.page.problems).toEqual([`index.md:3: categories: "Guides" is not a category: a category is lowercase letters, digits and hyphens, such as "design-systems"`]);
    const twice = await assemble("/", { "index.md": page("Home", "categories: [design-systems, ds]\n") });
    expect(twice.page.problems).toEqual([`index.md:3: categories: "design-systems" is listed twice ("ds" is its old key)`]);
  });

  it("an old key builds as the category it now is, with a warning that names the page", async () => {
    const { page: p, data } = await assemble("/", { "index.md": page("Home", "categories: [ds]\n") }, { declared: ["categories"] });
    expect(p.problems).toEqual([]);
    expect(data).toEqual({ categories: [DS] });
    expect(p.notes).toContain(`warning: index.md:3: category "ds" is now "design-systems" (renamed in storefront.categories): write "design-systems"`);
  });

  it("are on the page's listing entry, resolved the same way", async () => {
    const { data } = await assemble("/articles/", {
      "index.md": page("Home"),
      "articles/index.md": page("Articles"),
      "articles/a.md": page("A", "categories: [ds, guides]\n"),
      "articles/b.md": page("B"),
    }, { declared: ["children"] });
    expect((data?.["children"] as Array<{ route: string; categories: unknown }>).map(e => [e.route, e.categories])).toEqual([
      ["/articles/a/", [DS, GUIDES]], ["/articles/b/", []]]);
  });
});

describe("site.categories", () => {
  const base = { properties: { site: { properties: { categories: { description: "Every category" } } } } };

  it("is every declared category, in the config's order, on every page, when partials/base lists it", async () => {
    const { page: p, site } = await assemble("/", { "index.md": page("Home") }, { base });
    expect(p.problems).toEqual([]);
    expect(site?.["categories"]).toEqual([DS, GUIDES]);
    expect(p.html).toContain("<ol><li>design-systems</li><li>guides</li></ol>");
  });

  it("is [] for a site that declares none, and absent when partials/base doesn't list it", async () => {
    expect((await assemble("/", { "index.md": page("Home") }, { base, categories: undefined })).site?.["categories"]).toEqual([]);
    expect(Object.hasOwn((await assemble("/", { "index.md": page("Home") })).site ?? {}, "categories")).toBe(false);
  });

  it("is refused with a shape of the skin's, or set in the config", async () => {
    const shaped = { properties: { site: { properties: { categories: { type: "array" } } } } };
    expect((await assemble("/", { "index.md": page("Home") }, { base: shaped })).page.problems).toEqual([
      `partials/base declares "type" for site.categories: the shape of a category is Pattern Dump's, so list the name only (a description at most)`]);
    expect((await assemble("/", { "index.md": page("Home") }, { base, site: { categories: [] } })).page.problems).toEqual([
      `storefront.site.categories is filled by Pattern Dump from storefront.categories: list it in partials/base's schema, and don't set it in storefront.site`]);
  });
});
