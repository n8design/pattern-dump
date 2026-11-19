// Tag and category pages (terms.ts): tags declared like categories, a tag or category as { key, label, description,
// route }, a generated page per term with a published page (through the skin's layouts/tag and layouts/category) and
// an index of them (layouts/tags, layouts/categories), listing its pages through a query with `tags: same`. Old
// templates that write a tag as text fail with the fix named.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorefrontCategory, StorefrontTermPages } from "@pattern-dump/config";
import type { RenderInput } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { readPages } from "../src/storefront/pages.js";
import { buildCompositionRegistry } from "../src/composition.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { sitemapEntries } from "../src/storefront/site-files.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

const page = (title: string, extra = ""): string => `---\ntitle: ${title}\n${extra}---\n\nBody of ${title}.\n`;

const TERM_LAYOUT = (query: string) => ({
  hbs: "{{#> partials-base}}<main><h1>{{title}}</h1><p class=\"n\">{{page.term.count}}</p>"
    + "<ul>{{#each page.pages.entries}}<li><a href=\"{{route}}\">{{title}}</a></li>{{/each}}</ul></main>{{/partials-base}}",
  schema: { properties: { title: { type: "string" }, description: { type: "string" }, page: { type: "object", properties: {
    term: {}, pages: { "x-pd-query": { [query]: "same", sort: "title" } },
  } } } },
});
const INDEX_LAYOUT = {
  hbs: "{{#> partials-base}}<main><h1>{{title}}</h1><ul>{{#each page.terms}}<li><a href=\"{{route}}\">{{label}}</a> {{count}}</li>{{/each}}</ul></main>{{/partials-base}}",
  schema: { properties: { title: { type: "string" }, page: { type: "object", properties: { terms: {} } } } },
};

interface Site {
  tags?: Record<string, StorefrontCategory>; categories?: Record<string, StorefrontCategory>;
  tagPages?: boolean | StorefrontTermPages; categoryPages?: boolean | StorefrontTermPages;
  /** The skin's layouts besides page: tag, tags, category, categories (default: all four). */
  layouts?: string[];
  /** Templates to replace or add, by path under patterns. */
  patterns?: Record<string, string>;
  pageLayout?: string;
  mode?: "dev" | "build";
}

async function site(files: Record<string, string>, o: Site = {}) {
  const root = await mkdtemp(join(tmpdir(), "pd-terms-"));
  roots.push(root);
  const patterns = join(root, "patterns");
  const layouts = o.layouts ?? ["tag", "tags", "category", "categories"];
  const all: Record<string, string> = {
    "layouts/page/page.hbs": o.pageLayout
      ?? "{{#> partials-base}}<main><h1>{{title}}</h1>{{{body}}}<ul>{{#each page.tags}}<li><a href=\"{{route}}\">{{label}}</a></li>{{/each}}</ul></main>{{/partials-base}}",
    "layouts/page/page.schema.json": JSON.stringify({ properties: { title: { type: "string" }, page: { type: "object", properties: { tags: {}, categories: {} } } } }),
    "partials/base/base.hbs": "<div>{{> @partial-block}}</div>",
    "partials/base/base.schema.json": "{}",
  };
  for (const [name, query] of [["tag", "tags"], ["category", "categories"]] as const) {
    if (!layouts.includes(name)) continue;
    const l = TERM_LAYOUT(query);
    all[`layouts/${name}/${name}.hbs`] = l.hbs;
    all[`layouts/${name}/${name}.schema.json`] = JSON.stringify(l.schema);
  }
  for (const name of ["tags", "categories"]) {
    if (!layouts.includes(name)) continue;
    all[`layouts/${name}/${name}.hbs`] = INDEX_LAYOUT.hbs;
    all[`layouts/${name}/${name}.schema.json`] = JSON.stringify(INDEX_LAYOUT.schema);
  }
  Object.assign(all, o.patterns ?? {});
  for (const [rel, body] of Object.entries(all)) await save(join(patterns, ...rel.split("/")), body);
  for (const [rel, body] of Object.entries(files)) await save(join(root, "pages", ...rel.split("/")), body);
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
  const mode = o.mode ?? "dev";
  const model = await readPages(join(root, "pages"), {
    categories: o.categories, tags: o.tags, tagPages: o.tagPages, categoryPages: o.categoryPages,
    layouts: new Set([...discoveryMap.keys()].filter(id => id.startsWith("layouts/")).map(id => id.slice("layouts/".length))),
    drafts: mode === "dev" ? "show" : "leave-out", scheduled: mode === "dev" ? "show" : "leave-out", today: "2026-11-16",
  });
  const composition = await buildCompositionRegistry(patterns, handleMap, discoveryMap);
  const assemble = async (route: string, extra: Partial<PageAssembly> = {}) => {
    const inputs: RenderInput[] = [];
    const p = await assemblePage(route, model, {
      discoveryMap, handleMap, composition, site: undefined, workbenchUrl: "https://wb.example/", shown: x => x, head: async () => "",
      image: async () => ({ ok: false, message: "no images here" }),
      render: input => { inputs.push(input); return render(input); },
      ...(mode === "dev" ? { live: { wsPort: 1, generation: "" } } : {}), ...extra,
    } as PageAssembly);
    const data = inputs.find(i => i.component.startsWith("layouts/"))?.data as { page?: Record<string, unknown>; title?: unknown } | undefined;
    return { page: p, data: data?.page, title: data?.title };
  };
  return { model, assemble };
}

const CSS = { key: "css", label: "CSS", description: "Cascading style sheets" };

describe("a page's tags", () => {
  it("without site.tags: any tag, its label its key, its route its tag page", async () => {
    const s = await site({ "index.md": page("Home", "tags: [css, html]\n") });
    const { page: p, data } = await s.assemble("/");
    expect(p.problems).toEqual([]);
    expect(data?.["tags"]).toEqual([
      { key: "css", label: "css", description: null, route: "/tags/css/" },
      { key: "html", label: "html", description: null, route: "/tags/html/" },
    ]);
    expect(p.html).toContain(`<li><a href="/tags/css/">css</a></li>`);
  });

  it("with site.tags: the declared label and description; an old key builds as its tag, with a warning", async () => {
    const s = await site({ "index.md": page("Home", "tags: [styles]\n") }, { tags: { css: { label: "CSS", description: "Cascading style sheets", aliases: ["styles"] } } });
    const { page: p, data } = await s.assemble("/");
    expect(p.problems).toEqual([]);
    expect(data?.["tags"]).toEqual([{ ...CSS, route: "/tags/css/" }]);
    expect(p.notes).toContain(`warning: index.md:3: tag "styles" is now "css" (renamed in site.tags): write "css"`);
  });

  it("with site.tags: an undeclared tag fails the page, with a did-you-mean", async () => {
    const s = await site({ "index.md": page("Home", "tags: [csss]\n") }, { tags: { css: { label: "CSS" } } });
    const { page: p } = await s.assemble("/");
    expect(p.problems).toEqual([`index.md:3: tags: "csss" is not a tag: did you mean "css"?`]);
  });

  it("have a null route without tag pages", async () => {
    const s = await site({ "index.md": page("Home", "tags: [css]\n") }, { layouts: [] });
    expect((await s.assemble("/")).data?.["tags"]).toEqual([{ key: "css", label: "css", description: null, route: null }]);
  });
});

describe("a template that writes a tag as text", () => {
  it("fails the page, naming the template, its line and what to write instead", async () => {
    const s = await site({ "index.md": page("Home", "tags: [css]\n") }, {
      pageLayout: "{{#> partials-base}}<main><h1>{{title}}</h1>\n<ul>{{#each page.tags}}<li>{{this}}</li>{{/each}}</ul></main>{{/partials-base}}",
    });
    const { page: p } = await s.assemble("/");
    expect(p.status).toBe(500);
    expect(p.problems).toEqual([`layouts/page (page.hbs:2): {{#each page.tags}} writes {{this}}, but a tag is an object since 0.5.0 `
      + `(key, label, description, route): write {{label}} to show it ({{key}} is its URL segment, {{route}} its page)`]);
  });

  it("fails it in a partial the layout includes too", async () => {
    const s = await site({ "index.md": page("Home", "tags: [css]\n") }, {
      pageLayout: "{{#> partials-base}}<main><h1>{{title}}</h1>{{> partials-tags}}</main>{{/partials-base}}",
      patterns: { "partials/tags/tags.hbs": "{{#each page.tags}}{{.}}{{/each}}" },
    });
    expect((await s.assemble("/")).page.problems).toEqual([expect.stringMatching(/^partials\/tags \(tags\.hbs:1\): \{\{#each page\.tags\}\} writes \{\{\.\}\}/)]);
  });

  it("fails it for an included component whose schema declares tags as strings, though its template is right", async () => {
    const s = await site({ "index.md": page("Home", "tags: [css]\n") }, {
      pageLayout: "{{#> partials-base}}<main><h1>{{title}}</h1>{{> components-tag-list tags=page.tags}}</main>{{/partials-base}}",
      patterns: {
        "components/tag-list/tag-list.hbs": "<ul>{{#each tags}}<li>{{label}}</li>{{/each}}</ul>",
        "components/tag-list/tag-list.schema.json": JSON.stringify({ type: "object", properties: { tags: { type: "array", items: { type: "string" } } } }),
      },
    });
    expect((await s.assemble("/")).page.problems).toEqual([`components/tag-list (tag-list.schema.json) declares tags as a list of strings, `
      + `but a tag is an object since 0.5.0 (key, label, description, route): declare its items as "type": "object", or leave items out`]);
  });
});

describe("tag pages", () => {
  const files = {
    "index.md": page("Home"),
    "a.md": page("Alpha", "tags: [css, html]\n"),
    "b.md": page("Beta", "tags: [css]\n"),
    "c.md": page("Gamma", "tags: [js]\ndraft: true\n"),
    "d.md": page("Delta", "tags: [js, css]\ndate: 2026-12-01\n"),
  };

  it("one per tag with a published page, at /tags/<key>/, its pages through the layout's query (tags: same)", async () => {
    const s = await site(files);
    const { page: p, data, title } = await s.assemble("/tags/css/");
    expect(p.problems).toEqual([]);
    expect(title).toBe("css");
    expect(data?.["term"]).toEqual({ key: "css", label: "css", description: null, route: "/tags/css/", count: 2 });
    // The draft and the scheduled page are never listed, in pd dev either.
    expect((data?.["pages"] as { entries: Array<{ title: string }> }).entries.map(e => e.title)).toEqual(["Alpha", "Beta"]);
    expect(p.html).toContain(`<title>css</title>`);
  });

  it("none for a tag only drafts and scheduled pages have", async () => {
    const s = await site(files);
    expect(s.model.pages.map(x => x.route).filter(r => r.startsWith("/tags/"))).toEqual(["/tags/", "/tags/css/", "/tags/html/"]);
    expect((await s.assemble("/tags/js/")).page.status).toBe(404);
  });

  it("an index at /tags/, every tag with a page, by label, with its count", async () => {
    const s = await site(files, { tags: { css: { label: "CSS" }, html: { label: "HTML" }, js: { label: "JavaScript" } } });
    const { page: p, data, title } = await s.assemble("/tags/");
    expect(p.problems).toEqual([]);
    expect(title).toBe("Tags");
    expect(data?.["terms"]).toEqual([
      { key: "css", label: "CSS", description: null, route: "/tags/css/", count: 2 },
      { key: "html", label: "HTML", description: null, route: "/tags/html/", count: 1 },
    ]);
  });

  it("are not in the nav, and are in the sitemap", async () => {
    const s = await site(files);
    expect(s.model.nav.map(n => n.route)).not.toContain("/tags/");
    expect(sitemapEntries(s.model, "https://example.com/").map(e => e.url)).toEqual(expect.arrayContaining([
      "https://example.com/tags/", "https://example.com/tags/css/", "https://example.com/tags/html/",
    ]));
  });

  it("under another path, with another index title", async () => {
    const s = await site(files, { tagPages: { path: "topics", title: "Topics" } });
    expect((await s.assemble("/topics/css/")).page.problems).toEqual([]);
    expect((await s.assemble("/topics/")).title).toBe("Topics");
    expect((await s.assemble("/tags/css/")).page.status).toBe(404);
  });

  it("are left out without layouts/tag, with no problem, and with tagPages: false", async () => {
    for (const o of [{ layouts: [] }, { tagPages: false }] satisfies Site[]) {
      const s = await site(files, o);
      expect(s.model.problems).toEqual([]);
      expect(s.model.pages.some(x => x.route.startsWith("/tags/"))).toBe(false);
    }
  });

  it("without the index layout: tag pages, and no index", async () => {
    const s = await site(files, { layouts: ["tag"] });
    expect(s.model.problems).toEqual([]);
    expect(s.model.pages.map(x => x.route)).toContain("/tags/css/");
    expect(s.model.pages.map(x => x.route)).not.toContain("/tags/");
  });

  it("asked for with tagPages: true, a missing layout is a problem naming it", async () => {
    const s = await site(files, { layouts: ["tag"], tagPages: true });
    expect(s.model.problems).toEqual([
      `site.tagPages asks for tag pages, but the skin has no layout "tags" (the index of the tags): add layouts/tags, or mark a page or template pattern with "x-pd-layout": "tags", or set tagPages to false`,
    ]);
  });

  it("a page of the pages folder at a generated route is a problem naming both and the fix", async () => {
    const s = await site({ ...files, "tags/index.md": page("My tags") });
    expect(s.model.problems).toEqual([
      `tags/index.md is the page at /tags/, which is the index of the tags as well: rename tags/, or give the tag pages another path (site.tagPages: { path: "..." })`,
    ]);
  });

  it("an old key of a tag forwards to the tag's page", async () => {
    const s = await site(files, { tags: { css: { label: "CSS", aliases: ["styles"] }, html: { label: "HTML" }, js: { label: "JS" } } });
    expect(s.model.pages.find(x => x.route === "/tags/css/")?.redirectFrom).toEqual(["/tags/styles/"]);
  });

  it("in pd build: the scheduled page's and the draft's tags have no page", async () => {
    const s = await site(files, { mode: "build" });
    expect(s.model.pages.map(x => x.route).filter(r => r.startsWith("/tags/"))).toEqual(["/tags/", "/tags/css/", "/tags/html/"]);
    expect((await s.assemble("/tags/css/")).page.problems).toEqual([]);
  });
});

describe("category pages", () => {
  it("one per category with a published page, at /categories/<key>/, with an index", async () => {
    const categories = { guides: { label: "Guides", description: "How to", aliases: ["howto"] }, news: { label: "News" } };
    const s = await site({ "index.md": page("Home"), "a.md": page("Alpha", "categories: [guides]\n") }, { categories });
    const { page: p, data, title } = await s.assemble("/categories/guides/");
    expect(p.problems).toEqual([]);
    expect(title).toBe("Guides");
    expect(data?.["term"]).toEqual({ key: "guides", label: "Guides", description: "How to", route: "/categories/guides/", count: 1 });
    expect((await s.assemble("/categories/")).data?.["terms"]).toEqual([
      { key: "guides", label: "Guides", description: "How to", route: "/categories/guides/", count: 1 },
    ]);
    expect(s.model.pages.find(x => x.route === "/categories/guides/")?.redirectFrom).toEqual(["/categories/howto/"]);
    expect((await s.assemble("/categories/news/")).page.status).toBe(404);
  });
});

describe("a query's tags and categories", () => {
  const related = (query: Record<string, unknown>) => ({
    "layouts/article/article.hbs": "{{#> partials-base}}<main><h1>{{title}}</h1>{{#each page.more.entries}}<i>{{title}}</i>{{/each}}</main>{{/partials-base}}",
    "layouts/article/article.schema.json": JSON.stringify({ properties: { title: { type: "string" }, page: { type: "object", properties: {
      more: { "x-pd-query": { sort: "title", ...query } },
    } } } }),
  });

  it("same: the page's own tags, on any page; on a page with none, no page at all", async () => {
    const s = await site({
      "index.md": page("Home"), "a.md": page("Alpha", "layout: article\ntags: [css]\n"), "b.md": page("Beta", "tags: [css]\n"),
      "c.md": page("Gamma", "tags: [html]\n"), "d.md": page("Delta", "layout: article\n"),
    }, { patterns: related({ tags: "same" }) });
    expect((await s.assemble("/a/")).page.html).toContain("<i>Beta</i></main>");
    const none = await s.assemble("/d/");
    expect(none.page.problems).toEqual([]);
    expect((none.data?.["more"] as { entries: unknown[] }).entries).toEqual([]);
  });

  it("with site.tags: a tag that isn't declared fails, with a did-you-mean; a declared tag no page has lists none", async () => {
    const tags = { css: { label: "CSS" }, html: { label: "HTML" } };
    const typo = await site({ "index.md": page("Home", "layout: article\n"), "a.md": page("Alpha", "tags: [css]\n") }, { tags, patterns: related({ tags: ["htm"] }) });
    expect((await typo.assemble("/")).page.problems).toEqual([
      `layouts/article (x-pd-query of page.more): tags: "htm" is not a tag: did you mean "html"?`,
    ]);
    const unused = await site({ "index.md": page("Home", "layout: article\n"), "a.md": page("Alpha", "tags: [css]\n") }, { tags, patterns: related({ tags: ["html"] }) });
    expect((await unused.assemble("/")).page.problems).toEqual([]);
  });
});

describe("search and sharing", () => {
  const files = {
    "index.md": page("Home"),
    "a.md": page("Alpha", "date: 2026-11-02\ntags: [css]\ncategories: [guides, news]\n"),
  };
  const o: Site = { tags: { css: { label: "CSS" } }, categories: { guides: { label: "Guides" }, news: { label: "News" } } };
  const ld = (html: string) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]!) as { "@graph": Array<Record<string, unknown>> };

  it("an article: article:section is its first category's label, article:tag and keywords its tags' labels, articleSection every category's", async () => {
    const s = await site(files, o);
    const { page: p } = await s.assemble("/a/", { siteUrl: "https://example.com/" });
    expect(p.problems).toEqual([]);
    expect(p.html).toContain(`<meta property="article:section" content="Guides">`);
    expect(p.html).not.toContain(`content="News">`);
    expect(p.html).toContain(`<meta property="article:tag" content="CSS">`);
    const article = ld(p.html)["@graph"].find(n => n["@type"] === "Article")!;
    expect(article["articleSection"]).toEqual(["Guides", "News"]);
    expect(article["keywords"]).toEqual(["CSS"]);
  });

  it("one category is one articleSection string", async () => {
    const s = await site({ ...files, "a.md": page("Alpha", "date: 2026-11-02\ncategories: [guides]\n") }, o);
    const article = ld((await s.assemble("/a/", { siteUrl: "https://example.com/" })).page.html)["@graph"].find(n => n["@type"] === "Article")!;
    expect(article["articleSection"]).toBe("Guides");
  });

  it("a tag page and an index are a CollectionPage, of type website", async () => {
    const s = await site(files, o);
    for (const route of ["/tags/css/", "/tags/", "/categories/guides/"]) {
      const { page: p } = await s.assemble(route, { siteUrl: "https://example.com/" });
      expect(p.problems, route).toEqual([]);
      expect(ld(p.html)["@graph"].map(n => n["@type"]), route).toEqual(["WebSite", "CollectionPage"]);
      expect(p.html, route).toContain(`<meta property="og:type" content="website">`);
    }
  });

  it("the sitemap's lastmod of a tag page is its newest page's change", async () => {
    const s = await site({ ...files, "b.md": page("Beta", "date: 2026-10-01\nupdated: 2026-11-10\ntags: [css]\n") }, o);
    expect(sitemapEntries(s.model, "https://example.com/").find(e => e.url === "https://example.com/tags/css/")).toEqual({ url: "https://example.com/tags/css/", lastmod: "2026-11-10" });
  });
});
