// Folder defaults: `childDefaults:` on a folder's index.md sets frontmatter for the pages under it (folder-defaults.ts).
// Nearest folder per key, a query's options one by one, lists replaced, the page's own value first; the keys that
// can't be defaulted; and every problem about a defaulted value naming the index.md and line it came from.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages, type PageModel } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-folder-defaults-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const json = (v: unknown) => JSON.stringify(v);
const LAYOUTS: Record<string, string> = {
  "patterns/layouts/page/page.hbs": "<main><h1>{{title}}</h1>{{{body}}}</main>",
  "patterns/layouts/page/page.schema.json": json({ properties: { title: { type: "string" } } }),
  "patterns/layouts/service/service.hbs": "<main><h1>{{title}}</h1><p>{{audience}}</p>{{{body}}}{{{page.related.listing}}}</main>",
  "patterns/layouts/service/service.schema.json": json({ properties: {
    title: { type: "string" }, audience: { type: "string", enum: ["business", "public"] },
    page: { properties: { related: { "x-pd-query": { sort: "title", limit: 5 } } } },
  } }),
};

let n = 0;
async function project(files: Record<string, string>): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries({ ...LAYOUTS, ...files })) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  return root;
}
const fm = (lines: string[], body = "Text.") => `---\n${lines.join("\n")}\n---\n\n${body}\n`;

async function assembled(root: string, model: PageModel, route: string) {
  const patterns = join(root, "patterns");
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const a: PageAssembly = {
    discoveryMap, handleMap, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap),
    render: createRenderer({ patternsDir: patterns, discoveryMap, handleMap }), shown: p => p, site: undefined,
    workbenchUrl: "https://wb.test/", head: async () => "", image: async () => ({ ok: true }),
  };
  return assemblePage(route, model, a);
}

const SERVICES = fm([
  "title: Services",            // 2
  "childDefaults:",             // 3
  "  layout: service",          // 4
  "  audience: business",       // 5
  "  tags: [consulting]",       // 6
  "  related:",                 // 7
  "    sort: date",             // 8
  "    limit: 2",               // 9
]);

describe("folder defaults: what a page gets", () => {
  let model: PageModel;
  beforeAll(async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/services/index.md": SERVICES,
      "pages/services/web.md": fm(["title: Web"]),
      "pages/services/own.md": fm(["title: Own", "audience: public", "tags: [setup]", "related:", "  limit: 4"]),
      "pages/services/europe/index.md": fm(["title: Europe", "childDefaults:", "  related:", "    limit: 3"]),
      "pages/services/europe/berlin.md": fm(["title: Berlin"]),
    });
    model = await readPages(join(root, "pages"));
  });
  const page = (route: string) => model.files.get(route)!;

  it("a page takes its folder's defaults, merged into its frontmatter", () => {
    const f = page("/services/web/").frontmatter;
    expect(f.values).toMatchObject({ title: "Web", audience: "business", tags: ["consulting"] });
    expect(f.maps["related"]).toEqual({ sort: "date", limit: "2" });
  });

  it("its own value wins, per key and per query option; a list is replaced, never joined", () => {
    const f = page("/services/own/").frontmatter;
    expect(f.values).toMatchObject({ audience: "public", tags: ["setup"] });
    expect(f.maps["related"]).toEqual({ limit: "4", sort: "date" });
  });

  it("the nearest folder wins per key, and a query's options merge one by one", () => {
    const f = page("/services/europe/berlin/").frontmatter;
    expect(f.maps["related"]).toEqual({ limit: "3", sort: "date" });
    expect(f.values).toMatchObject({ audience: "business" });
  });

  it("childDefaults.layout is the folder's default layout, as childLayout is", () => {
    expect(model.pages.find(p => p.route === "/services/web/")).toMatchObject({ layout: "service", layoutFrom: "services/index.md" });
  });

  it("a folder's defaults are for the pages under it: its own index.md takes its parent's", () => {
    expect(page("/services/").frontmatter.values["audience"]).toBeUndefined();
    expect(page("/services/europe/").frontmatter.values).toMatchObject({ audience: "business" });
    expect(model.pages.find(p => p.route === "/services/")?.defaultsFrom).toBeUndefined();
  });

  it("/api/pages names where each defaulted key came from, a query's options one by one", () => {
    expect(model.pages.find(p => p.route === "/services/europe/berlin/")?.defaultsFrom).toEqual({
      audience: "services/index.md", related: "services/europe/index.md",
      "related.limit": "services/europe/index.md", "related.sort": "services/index.md", tags: "services/index.md",
    });
    expect(model.pages.find(p => p.route === "/services/own/")?.defaultsFrom).toEqual({ "related.sort": "services/index.md" });
  });
});

describe("folder defaults: drafts", () => {
  it("pd build names the drafts that came from a folder's childDefaults, by that index.md", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/beta/index.md": fm(["title: Beta", "childDefaults:", "  draft: true"]),
      "pages/beta/a.md": fm(["title: A"]),
      "pages/beta/b.md": fm(["title: B"]),
      "pages/beta/c.md": fm(["title: C", "draft: false"]),
      "pages/own.md": fm(["title: Own", "draft: true"]),
    });
    const model = await readPages(join(root, "pages"), { drafts: "leave-out" });
    expect(model.drafts).toEqual(["beta/a.md", "beta/b.md", "own.md"]);
    expect(model.draftsByDefaults).toEqual([{ path: "beta/a.md", from: "beta/index.md" }, { path: "beta/b.md", from: "beta/index.md" }]);
  });
});

describe("folder defaults: checks", () => {
  it("a defaulted value with a problem names the page, the index.md and the line it came from", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/services/index.md": fm(["title: Services", "childDefaults:", "  layout: service", "  audience: everyone", "  related:", "    limit: two"]),
      "pages/services/web.md": fm(["title: Web"]),
    });
    const page = await assembled(root, await readPages(join(root, "pages")), "/services/web/");
    expect(page.problems).toContain(`services/web.md (from the childDefaults of services/index.md, line 5): "audience" must be one of "business", "public" (got "everyone")`);
    expect(page.problems.some(p => p.startsWith("services/web.md (from the childDefaults of services/index.md, line 7):") && p.includes("limit"))).toBe(true);
  });

  it("a default the page's layout doesn't declare is a problem on that page, naming where it came from", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/services/index.md": fm(["title: Services", "childDefaults:", "  audience: business"]),
      "pages/services/web.md": fm(["title: Web"]),
    });
    const page = await assembled(root, await readPages(join(root, "pages")), "/services/web/");
    expect(page.problems.some(p => p.startsWith("services/web.md (from the childDefaults of services/index.md, line 4):") && p.includes(`"audience"`))).toBe(true);
  });

  it("on the index.md: a key that can't be defaulted, layout beside childLayout, and a bad build key, each at its line", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/services/index.md": fm(["title: Services", "childLayout: service", "childDefaults:", "  title: Same", "  layout: service", "  toc: maybe"]),
    });
    const page = await assembled(root, await readPages(join(root, "pages")), "/services/");
    expect(page.problems).toEqual(expect.arrayContaining([
      `services/index.md:5: childDefaults.title: "title" can't be set for a folder's pages (it is one page's own): set it on each page`,
      `services/index.md:6: childDefaults.layout and childLayout both set the layout of this folder's pages: keep one`,
      `services/index.md:7: childDefaults.toc must be true or false`,
    ]));
  });
});
