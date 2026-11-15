// A folder's default layout (`childLayout` on its index.md): a page without its own `layout:` takes the
// childLayout of the nearest folder above it that sets one, else `page`. A folder's index.md is a page of its
// parent folder, so its own childLayout is for the pages under it. Each page is checked against the layout it
// ends up with, and every problem about that layout names where it came from.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { readPages, type PageModel } from "../src/storefront/pages.js";
import { checkPageFrontmatter } from "../src/storefront/frontmatter-contract.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
let map: DiscoveryMap;
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pd-child-layout-"));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    const file = join(root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await save(file, body);
  }
  return root;
}
const md = (title: string, extra = ""): string => `---\ntitle: ${title}\n${extra}---\n\nBody of ${title}.\n`;

beforeAll(async () => {
  const patterns = await tree({
    "layouts/page/page.hbs": "<main>{{title}}{{{body}}}</main>",
    "layouts/page/page.schema.json": JSON.stringify({ required: ["title"], properties: { title: { type: "string" }, description: { type: "string" } } }),
    "layouts/article/article.hbs": "<main>{{title}} {{subtitle}}{{{body}}}</main>",
    "layouts/article/article.schema.json": JSON.stringify({ required: ["title", "subtitle"], properties: { title: { type: "string" }, subtitle: { type: "string" } } }),
    "layouts/doc/doc.hbs": "<main>{{title}}{{{body}}}</main>",
    "layouts/doc/doc.schema.json": JSON.stringify({ required: ["title"], properties: { title: { type: "string" } } }),
  });
  map = (await buildDiscoveryMap(patterns)).discoveryMap;
});

const layouts = (model: PageModel) => Object.fromEntries(model.pages.map(p => [p.route, { layout: p.layout, ...(p.layoutFrom ? { from: p.layoutFrom } : {}) }]));
const problemsOf = async (model: PageModel, route: string) =>
  (await checkPageFrontmatter(model.files.get(route)!, map, model.categories)).problems.map(p => `${p.file}${p.line !== undefined ? `:${p.line}` : ""}: ${p.message}`);

describe("childLayout: which layout a page gets, and from where", () => {
  it("inherits the nearest folder's childLayout; its own layout wins; a folder's index.md takes its parent's", async () => {
    const model = await readPages(await tree({
      "index.md": md("Home", "childLayout: article\nsubtitle: s\n"),
      "about.md": md("About", "subtitle: s\n"),
      "docs/index.md": md("Docs", "childLayout: doc\nsubtitle: s\n"),
      "docs/a.md": md("A"),
      "docs/own.md": md("Own", "layout: page\n"),
      "docs/sub/index.md": md("Sub"),
      "docs/sub/x.md": md("X"),
    }));
    expect(model.problems).toEqual([]);
    expect(layouts(model)).toEqual({
      "/": { layout: "page" },
      "/about/": { layout: "article", from: "index.md" },
      "/docs/": { layout: "article", from: "index.md" },
      "/docs/a/": { layout: "doc", from: "docs/index.md" },
      "/docs/own/": { layout: "page" },
      "/docs/sub/": { layout: "doc", from: "docs/index.md" },
      "/docs/sub/x/": { layout: "doc", from: "docs/index.md" },
    });
    // The check takes the same layout: the inherited one's schema applies.
    expect((await checkPageFrontmatter(model.files.get("/docs/a/")!, map)).layoutId).toBe("layouts/doc");
    expect(await problemsOf(model, "/docs/a/")).toEqual([]);
  });

  it("checks a page against the schema of the layout it inherits", async () => {
    const model = await readPages(await tree({
      "index.md": md("Home"),
      "articles/index.md": md("Articles", "childLayout: article\n"),
      "articles/one.md": md("One", "description: Not an article key\n"),
    }));
    expect(await problemsOf(model, "/articles/one/")).toEqual([
      `articles/one.md:3: "description" is not declared by layout "article" (the childLayout of articles/index.md)`,
      `articles/one.md: "subtitle" is required by layout "article" (the childLayout of articles/index.md)`,
    ]);
  });

  it("fails a childLayout that is not a layout, on the index.md and on each page that inherits it", async () => {
    const model = await readPages(await tree({
      "index.md": md("Home"),
      "articles/index.md": md("Articles", "childLayout: artcle\n"),
      "articles/one.md": md("One"),
    }));
    const known = `the layouts are "article", "doc", "page"`;
    expect(await problemsOf(model, "/articles/")).toEqual([`articles/index.md:3: childLayout "artcle" is not a layout: ${known}`]);
    expect(await problemsOf(model, "/articles/one/")).toEqual([
      `articles/one.md: layout "artcle" (the childLayout of articles/index.md) is not a layout: ${known}`,
    ]);
  });

  it("belongs on a folder's index.md, and is one name", async () => {
    const model = await readPages(await tree({
      "index.md": md("Home", "childLayout: [doc, page]\n"),
      "about.md": md("About", "childLayout: doc\n"),
    }));
    expect(layouts(model)["/about/"]).toEqual({ layout: "page" });
    expect(await problemsOf(model, "/")).toEqual(["index.md:3: childLayout must be one layout name, not a list"]);
    expect(await problemsOf(model, "/about/")).toEqual([
      "about.md:3: childLayout sets the layout of a folder's pages, so it belongs on the folder's index.md, not on a page",
    ]);
  });

  it("a layout cannot declare childLayout: a page sets it for the build", async () => {
    const patterns = await tree({
      "layouts/page/page.hbs": "<main>{{title}}</main>",
      "layouts/page/page.schema.json": JSON.stringify({ properties: { title: { type: "string" }, childLayout: { type: "string" } } }),
    });
    const own = (await buildDiscoveryMap(patterns)).discoveryMap;
    const model = await readPages(await tree({ "index.md": md("Home") }));
    expect((await checkPageFrontmatter(model.files.get("/")!, own)).problems.map(p => p.message)).toEqual([
      `layout "page" declares "childLayout", which a page sets for the build, not for its layout: rename it in the layout's schema`,
    ]);
  });
});
