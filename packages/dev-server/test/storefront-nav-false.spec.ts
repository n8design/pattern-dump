// `nav: false` in a page's frontmatter leaves it out of the nav: out of `nav` (and a folder's `children`), and so out
// of prev/next, its neighbours' and its own (both null, as for any page the nav does not list). The page itself still
// renders and stays in the sitemap and llms.txt. On a folder's index.md it leaves the folder's entry out, with its
// children. It is checked like the other true/false keys, and a folder can set it for its pages in childDefaults.
// The layout's own `nav` (the tree, filled by the storefront) is untouched by the key of the same name.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages, type PageModel } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { positionOf } from "../src/storefront/derived.js";
import { llmsTxt, sitemapEntries } from "../src/storefront/site-files.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-nav-false-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const json = (v: unknown) => JSON.stringify(v);
// The layout lists the nav it is given, and the page's prev and next.
const LAYOUTS: Record<string, string> = {
  "patterns/layouts/page/page.hbs": `<nav>{{#each nav}}<a href="{{route}}">{{title}}</a>{{#each children}}<a href="{{route}}">{{title}}</a>{{/each}}{{/each}}</nav>`
    + `<main><h1>{{title}}</h1>{{{body}}}</main><p class="prev">{{page.prev.route}}</p><p class="next">{{page.next.route}}</p>`,
  "patterns/layouts/page/page.schema.json": json({ properties: {
    title: { type: "string" }, nav: { type: "array" }, page: { properties: { prev: {}, next: {} } },
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

const navRoutes = (model: PageModel) => model.nav.flatMap(e => [e.route, ...(e.children ?? []).map(c => c.route)]);
const neighbours = (model: PageModel, route: string) => {
  const p = positionOf(route, model);
  return { prev: p.prev?.route ?? null, next: p.next?.route ?? null };
};

describe("nav: false on a top-level page and on a folder's page", () => {
  let root = "";
  let model: PageModel;
  beforeAll(async () => {
    root = await project({
      "pages/index.md": fm(["title: Home", "order: 1"]),
      "pages/about.md": fm(["title: About", "order: 2"]),
      "pages/credits.md": fm(["title: Credits", "order: 3", "nav: false"]),
      "pages/guide/index.md": fm(["title: Guide", "order: 4"]),
      "pages/guide/one.md": fm(["title: One", "order: 1"]),
      "pages/guide/hidden.md": fm(["title: Hidden", "order: 2", "nav: false"]),
      "pages/guide/two.md": fm(["title: Two", "order: 3"]),
      "pages/listed.md": fm(["title: Listed", "order: 5", "nav: true"]),
    });
    model = await readPages(join(root, "pages"));
  });

  it("is left out of nav and of its folder's children; nav: true is listed as before", () => {
    expect(model.problems).toEqual([]);
    expect(navRoutes(model)).toEqual(["/", "/about/", "/guide/", "/guide/one/", "/guide/two/", "/listed/"]);
  });

  it("its neighbours skip it in prev and next", () => {
    expect(neighbours(model, "/about/")).toEqual({ prev: "/", next: "/guide/" });
    expect(neighbours(model, "/guide/")).toEqual({ prev: "/about/", next: "/guide/one/" });
    expect(neighbours(model, "/guide/one/")).toEqual({ prev: "/guide/", next: "/guide/two/" });
    expect(neighbours(model, "/guide/two/")).toEqual({ prev: "/guide/one/", next: "/listed/" });
  });

  it("has no prev or next of its own", () => {
    expect(neighbours(model, "/credits/")).toEqual({ prev: null, next: null });
    expect(neighbours(model, "/guide/hidden/")).toEqual({ prev: null, next: null });
  });

  it("is still a page: it renders, with the nav that leaves it out and no neighbours", async () => {
    for (const route of ["/credits/", "/guide/hidden/"]) {
      const page = await assembled(root, model, route);
      expect(page.problems, route).toEqual([]);
      expect(page.status, route).toBe(200);
      expect(page.html).toContain(`<p class="prev"></p><p class="next"></p>`);
      expect(page.html).not.toContain(`<a href="/credits/">`);
      expect(page.html).not.toContain(`<a href="/guide/hidden/">`);
    }
    const about = await assembled(root, model, "/about/");
    expect(about.html).toContain(`<a href="/about/">About</a><a href="/guide/">Guide</a>`);
  });

  it("stays in pages, in its folder's order, and in the sitemap and llms.txt", () => {
    expect(model.pages.map(p => p.route)).toEqual(["/", "/about/", "/credits/", "/guide/", "/guide/one/", "/guide/hidden/", "/guide/two/", "/listed/"]);
    const urls = sitemapEntries(model, "https://site.test/").map(e => e.url);
    expect(urls).toContain("https://site.test/credits/");
    expect(urls).toContain("https://site.test/guide/hidden/");
    const llms = llmsTxt(model, { title: "Site", siteUrl: "https://site.test/" }).text;
    expect(llms).toContain("- [Credits](https://site.test/credits/)");
    expect(llms).toContain("- [Hidden](https://site.test/guide/hidden/)");
  });
});

describe("nav: false on a folder's index.md, and in childDefaults", () => {
  it("leaves the folder's entry out, with its children", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/legal/index.md": fm(["title: Legal", "nav: false"]),
      "pages/legal/terms.md": fm(["title: Terms"]),
    });
    const model = await readPages(join(root, "pages"));
    expect(navRoutes(model)).toEqual(["/"]);
    expect(neighbours(model, "/legal/terms/")).toEqual({ prev: null, next: null });
    expect((await assembled(root, model, "/legal/terms/")).status).toBe(200);
  });

  it("a folder's childDefaults sets it for the folder's pages, not for the index.md itself", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/legal/index.md": fm(["title: Legal", "childDefaults:", "  nav: false"]),
      "pages/legal/terms.md": fm(["title: Terms"]),
      "pages/legal/privacy.md": fm(["title: Privacy", "nav: true"]),
    });
    const model = await readPages(join(root, "pages"));
    expect(navRoutes(model)).toEqual(["/", "/legal/", "/legal/privacy/"]);
    const terms = await assembled(root, model, "/legal/terms/");
    expect(terms.problems).toEqual([]);
    expect(terms.status).toBe(200);
  });
});

describe("nav: checked like the other true/false keys", () => {
  it("a value other than true or false is a problem at its line", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/credits.md": fm(["title: Credits", "nav: hidden"]),
    });
    const page = await assembled(root, await readPages(join(root, "pages")), "/credits/");
    expect(page.problems).toEqual(["credits.md:3: nav must be true or false"]);
  });

  it("in childDefaults too, named with the index.md and its line", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/legal/index.md": fm(["title: Legal", "childDefaults:", "  nav: no"]),
      "pages/legal/terms.md": fm(["title: Terms"]),
    });
    const model = await readPages(join(root, "pages"));
    expect((await assembled(root, model, "/legal/")).problems).toEqual(["legal/index.md:4: childDefaults.nav must be true or false"]);
    expect((await assembled(root, model, "/legal/terms/")).problems)
      .toEqual([expect.stringMatching(/^legal\/terms\.md \(from the childDefaults of legal\/index\.md, line 4\).*nav must be true or false/)]);
  });
});

describe("pd build: a page with nav: false", () => {
  it("is written, with its sitemap entry, and no page lists it in its nav", async () => {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const root = join(tmp, "bench");
    for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
      const to = join(root, file.slice("storefront-bench/".length));
      await mkdir(dirname(to), { recursive: true });
      await cp(join(repo, file), to);
    }
    const about = join(root, "pages", "about.md");
    const text = await readFile(about, "utf8");
    await save(about, text.replace("title: About\n", "title: About\nnav: false\n"));
    const cfg = validateConfig({
      ...benchConfig, build: { workbench: false }, storefront: { ...benchConfig.storefront!, workbenchUrl: "/workbench/" },
    }, "test");
    const report = await buildStaticSite(cfg, root, { outDir: join(tmp, "bench-out"), pdVersion: "0.0.0-test", now: new Date("2027-01-02T03:04:05.000Z") });
    expect(report.storefront?.pages).toBeGreaterThan(0);
    const site = join(root, ".out", "storefront");
    expect(await stat(join(site, "about", "index.html")).then(() => true, () => false)).toBe(true);
    expect(await readFile(join(site, "sitemap.xml"), "utf8")).toContain("/about/</loc>");
    // The home page's nav, as the bench's layout writes it, no longer lists About.
    const home = await readFile(join(site, "index.html"), "utf8");
    const navOf = (html: string) => /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(navOf(home)).toContain(`href="/guides/"`);
    expect(navOf(home)).not.toContain(`href="/about/"`);
  }, 60_000);
});
