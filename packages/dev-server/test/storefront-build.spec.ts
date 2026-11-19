// pd build writes the storefront into its own output root: one HTML file per page at its route, the
// previews its pages embed, and every file those reference — and nothing of the workbench's. A storefront
// with any problem fails the build before its first write, so both output roots stay as they were.
// Built from copies of the bench, with a fixed clock; configs go through validateConfig, as loadConfig does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig, type SiteConfig } from "@pattern-dump/config";
import { buildStaticSite, startDevServer } from "@pattern-dump/dev-server";
import { relativeUrls } from "../src/storefront/page.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

/** Append `text` to `path`, as one save of the whole file. */
const append = async (path: string, text: string) => save(path, `${await readFile(path, "utf8")}${text}`);

const repo = fileURLToPath(new URL("../../../", import.meta.url));
// A fixed clock, after every date the bench's pages carry: the build's day decides which pages are scheduled.
const NOW = new Date("2027-01-02T03:04:05.000Z");
const WB = "https://workbench.example.test/";
let tmp = "";

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-build-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
async function benchCopy(): Promise<string> {
  const root = join(tmp, `bench-${n++}`);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  return root;
}
const config = (over: Partial<SiteConfig> = {}): PatternDumpConfig =>
  validateConfig({ ...benchConfig, site: { ...benchConfig.site!, ...over } }, "test");
const build = (root: string, out: string, cfg: PatternDumpConfig = config()) =>
  buildStaticSite(cfg, root, { outDir: out, pdVersion: "0.0.0-test", now: NOW });

async function tree(dir: string): Promise<Map<string, { bytes: Buffer; mtimeMs: number }>> {
  const out = new Map<string, { bytes: Buffer; mtimeMs: number }>();
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.set(relative(dir, p), { bytes: await readFile(p), mtimeMs: (await stat(p)).mtimeMs });
    }
  };
  await walk(dir);
  return out;
}
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("pd build — the storefront root", () => {
  let root = "";
  let report: Awaited<ReturnType<typeof build>>;
  let files: Map<string, { bytes: Buffer }>;
  beforeAll(async () => {
    root = await benchCopy();
    report = await build(root, join(root, "..", "wb-good"));
    files = await tree(join(root, ".out", "storefront"));
  }, 120_000);

  it("writes one HTML file per page at its route, the previews they embed, and what those reference", () => {
    expect([...files.keys()].sort()).toEqual([
      ".nojekyll",
      // The bench has no 404.md: the built-in page, through layouts/page.
      "404.html",
      "_pd/base.css",
      // The code colours: guides/setup.md and the home page show code (code.css, highlight.ts).
      "_pd/code.css",
      "_pd/components/components/callout.css",
      "_pd/components/components/card.css",
      // The about page places the icon label.
      "_pd/components/components/icon-label.css",
      "_pd/components/components/slide.css",
      "_pd/components/components/slider.css",
      "_pd/components/layouts/doc.css",
      "_pd/components/partials/base.css",
      "_pd/components/partials/footer.css",
      "_pd/components/partials/header.css",
      "_pd/components/partials/nav.css",
      // The guides page's photo slide, at its slot's five widths, the widest being the photo's own 2400 (the name
      // is the variant's key, a hash of the photo's bytes and the width); and the same photo in the setup guide's
      // prose, at the doc layout's three (480, 960, 1920).
      "_pd/images/images/cable-cars.56599118ae.1280.webp",
      "_pd/images/images/cable-cars.5dcc6d839f.1920.webp",
      "_pd/images/images/cable-cars.710900a530.160.webp",
      "_pd/images/images/cable-cars.826bce8ef6.480.webp",
      "_pd/images/images/cable-cars.9f3b14a5c3.2400.webp",
      "_pd/images/images/cable-cars.a95d087638.960.webp",
      "_pd/images/images/cable-cars.b05f7eb8ef.640.webp",
      "_pd/images/images/cable-cars.cec7974822.320.webp",
      "_pd/images/images/cable-cars.f21cb99719.1600.webp",
      // The behaviour scripts of the header (every layout's) and of the slider the guides page places.
      "_pd/scripts/header-ready.js",
      "_pd/scripts/slider-ready.js",
      // Each symbol image's standalone file, whether a page draws it or not.
      "_pd/symbols/flow.svg",
      "_pd/symbols/layers.svg",
      // The bench's two preview themes, linked by the previews the pages embed (never by a page).
      "_pd/themes/dark.css",
      "_pd/themes/light.css",
      "about/index.html",
      "articles/harbour/index.html",
      "articles/index.html",
      "articles/plain/index.html",
      // The link-preview images: the site's, about.md's own and the harbour article's (crawled from og:image).
      "assets/images/about.png",
      "assets/images/bench-blocks.svg",
      "assets/images/cable-cars.jpg",
      // The favicon the skin's head partial links on every page.
      "assets/images/favicon.png",
      "assets/images/share.png",
      // The category pages and their index, and the page that forwards from an old category key (ds).
      "categories/design-systems/index.html",
      "categories/ds/index.html",
      "categories/guides/index.html",
      "categories/index.html",
      "guides/index.html",
      "guides/setup/index.html",
      "index.html",
      "llms.txt",
      "preview/components/callout/index.html",
      "preview/components/callout~warning/index.html",
      "robots.txt",
      // The pages that forward from guides/setup.md's old routes.
      "setup/index.html",
      "sitemap.xml",
      "start/index.html",
      // The tag pages and their index, and the page that forwards from an old tag key (pictures).
      "tags/design/index.html",
      "tags/images/index.html",
      "tags/index.html",
      "tags/layout/index.html",
      "tags/pictures/index.html",
    ]);
    expect(report.storefront).toEqual({ outDir: join(root, ".out", "storefront"), basePath: "/", pages: 14, files: 57, bytes: expect.any(Number) });
    // llms.txt lists six pages: every page of the folder but the home page, whose title and description head it.
    expect(report.llms).toEqual({ pages: 6 });
  });

  it("notes a heading whose anchor the layout has, and leaves nothing out for it", () => {
    // The bench copy is outside any repository, so its doc layout's dates are null, noted once.
    expect(report.notes).toEqual([
      "the pages folder is not in a git repository: no page has dates",
      `guides/setup.md: heading "Main" is #main-1, because the layout uses id="main"`,
      // The bench's one link to another host, listed by the link check, not fetched.
      `an external link, not checked: https://example.test/source (on /, /guides/, /guides/setup/, /about/, /articles/, /articles/harbour/, /articles/plain/, /tags/, /tags/design/, /tags/images/, /tags/layout/, /categories/, /categories/design-systems/, /categories/guides/, /404.html)`,
    ]);
    expect(report.warnings).toEqual([]);
    const setup = files.get("guides/setup/index.html")!.bytes.toString("utf8");
    expect(setup).toContain(`<h2 id="main-1">Main</h2>`);
    expect(setup).toContain(`href="#main-1"`);
  });

  it("is the same, byte for byte, when built again", async () => {
    const again = await benchCopy();
    const second = await build(again, join(again, "..", "wb-again"));
    const files2 = await tree(join(again, ".out", "storefront"));
    expect([...files2.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [file, { bytes }] of files) expect(files2.get(file)!.bytes.equals(bytes), file).toBe(true);
    expect(second.notes).toEqual(report.notes);
  }, 120_000);

  it("resolves every reference inside it to a file it holds", () => {
    const missing: string[] = [];
    for (const [file, { bytes }] of files) {
      const text = bytes.toString("utf8");
      const refs = file.endsWith(".html")
        ? [...text.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map(m => m[1])
        : file.endsWith(".css") ? [...text.matchAll(/url\(\s*['"]?(\/[^'")\s]+)/g)].map(m => m[1]) : [];
      for (const ref of refs) {
        const path = ref.replace(/[?#].*$/, "").replace(/^\//, "");
        const target = path === "" || path.endsWith("/") ? `${path}index.html` : path;
        if (!files.has(target) && !files.has(`${target}/index.html`)) missing.push(`${file} → ${ref}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("links into the workbench at site.workbenchUrl, and carries no live-reload client and no shell CSS", () => {
    const setup = files.get("guides/setup/index.html")!.bytes.toString("utf8");
    expect(setup).toContain(`href="${WB}components/callout#warning"`);
    expect(setup).not.toContain("pd.localhost");
    for (const [file, { bytes }] of files) {
      expect(bytes.toString("utf8"), file).not.toContain("data-pd-live");
      expect(bytes.toString("utf8"), file).not.toContain("/_pd/main.css");
    }
  });

  it("with site.url: canonical and og:url on every page at the configured address, and no note about it", () => {
    expect(report.notes.some(n => n.startsWith("site.url is not set"))).toBe(false);
    for (const [route, file] of [["", "index.html"], ["about/", "about/index.html"], ["guides/setup/", "guides/setup/index.html"]]) {
      const html = files.get(file)!.bytes.toString("utf8");
      expect(html, file).toContain(`<link rel="canonical" href="https://bench.example.test/${route}">`);
      expect(html, file).toContain(`<meta property="og:url" content="https://bench.example.test/${route}">`);
    }
  });

  it("writes the 404 page with no relative URL in it, since a host serves it at every depth", () => {
    const html = files.get("404.html")!.bytes.toString("utf8");
    expect(html).toContain("There is no page at this address.");
    expect(relativeUrls(html)).toEqual([]);
    // It does reference stylesheets and links, all from the root.
    expect(html).toMatch(/<link rel="stylesheet" href="\/_pd\//);
    expect(html).toContain(`<a href="/">home page</a>`);
  });

  it("writes robots.txt, keeping crawlers out of the previews, and a sitemap of every page in route order", () => {
    expect(files.get("robots.txt")!.bytes.toString("utf8"))
      .toBe("User-agent: *\nDisallow: /preview/\n\nSitemap: https://bench.example.test/sitemap.xml\n");
    const sitemap = files.get("sitemap.xml")!.bytes.toString("utf8");
    // The schema's rules (sitemaps.org 0.9): its namespace, a <loc> per URL, absolute and at most 2048
    // characters. A <lastmod> is a page's own updated, else its own date (the two articles'); never git's.
    expect(sitemap.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`)).toBe(true);
    const urls = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map(m => [m[1]!, m[2] ?? null]);
    const locs = urls.map(u => u[0]!);
    expect(urls).toEqual([["https://bench.example.test/", null], ["https://bench.example.test/about/", null], ["https://bench.example.test/articles/", null],
      ["https://bench.example.test/articles/harbour/", "2026-11-01"], ["https://bench.example.test/articles/plain/", "2026-10-02"],
      // The generated pages: each its newest page's change.
      ["https://bench.example.test/categories/", "2026-11-15"], ["https://bench.example.test/categories/design-systems/", "2026-11-15"],
      ["https://bench.example.test/categories/guides/", "2026-11-15"],
      ["https://bench.example.test/guides/", null], ["https://bench.example.test/guides/setup/", "2026-11-15"],
      ["https://bench.example.test/tags/", "2026-11-01"], ["https://bench.example.test/tags/design/", "2026-10-02"],
      ["https://bench.example.test/tags/images/", "2026-11-01"], ["https://bench.example.test/tags/layout/", "2026-11-01"]]);
    expect(sitemap.match(/<url>/g)).toHaveLength(locs.length);
    for (const loc of locs) expect(loc.length).toBeLessThanOrEqual(2048);
  });

  // llmstxt.org: the site's title and description, then a section of the top-level pages and one per collection (a
  // folder with an index.md, led by it), each page's title, link and teaser. Tag and category pages are left out.
  it("writes llms.txt: the site, then each collection's pages with their teasers", () => {
    const llms = files.get("llms.txt")!.bytes.toString("utf8");
    const at = (route: string) => `https://bench.example.test${route}`;
    expect(llms).toBe([
      "# Storefront bench",
      "",
      "> A small website rendered from markdown, with the bench's own skin.",
      "",
      "## Pages",
      "",
      `- [About](${at("/about/")}): What the bench is for.`,
      "",
      "## Guides",
      "",
      `- [Guides](${at("/guides/")}): Longer texts about the bench.`,
      `- [Setup](${at("/guides/setup/")}): How the bench is put together.`,
      "",
      "## Articles",
      "",
      `- [Articles](${at("/articles/")}): Everything written for the bench, newest first.`,
      `- [A harbour of cable cars](${at("/articles/harbour/")}): This article has no description, so its listing shows this first `
        + "paragraph instead: the text of the page as it starts, without its markup, never shortened in the data. The card in the "
        + "listing limits it to three lines.",
      `- [Plain on purpose](${at("/articles/plain/")}): Why the bench's skin is a wireframe.`,
      "",
    ].join("\n"));
    expect(llms).not.toMatch(/\/tags\/|\/categories\//);
  });

  it("writes a page that forwards at each of a page's old routes, out of the sitemap", () => {
    for (const old of ["setup", "start"]) {
      const html = files.get(`${old}/index.html`)!.bytes.toString("utf8");
      expect(html).toContain(`<meta http-equiv="refresh" content="0; url=/guides/setup/">`);
      expect(html).toContain(`<link rel="canonical" href="https://bench.example.test/guides/setup/">`);
      expect(html).toContain(`<meta name="robots" content="noindex">`);
    }
    const sitemap = files.get("sitemap.xml")!.bytes.toString("utf8");
    for (const old of ["setup", "start"]) expect(sitemap).not.toContain(`<loc>https://bench.example.test/${old}/</loc>`);
  });

  it("is what pd dev serves, apart from the live-reload client, the workbench's address and the site's", async () => {
    const server = await startDevServer(config(), root, { port: 0, wsPort: 0 });
    try {
      for (const [route, file] of [["/", "index.html"], ["/about/", "about/index.html"], ["/guides/", "guides/index.html"], ["/guides/setup/", "guides/setup/index.html"],
        ["/articles/", "articles/index.html"], ["/articles/harbour/", "articles/harbour/index.html"]]) {
        const live = await new Promise<string>((resolve, reject) => {
          const req = request({ host: "127.0.0.1", port: server.port, path: route, headers: { host: `live.localhost:${server.port}` } }, res => {
            let body = ""; res.setEncoding("utf8"); res.on("data", c => { body += c; }); res.on("end", () => resolve(body));
          });
          req.on("error", reject); req.end();
        });
        const normalized = live
          .replace(/\n<script data-pd-live>[\s\S]*?<\/script>/, "\n")
          .replaceAll(`http://pd.localhost:${server.port}/`, WB)
          // pd dev's absolute URLs are the address the browser is on; the build's, storefront.url.
          .replaceAll(`http://live.localhost:${server.port}/`, benchConfig.site!.url!);
        expect(normalized, route).toBe(files.get(file)!.bytes.toString("utf8"));
      }
      for (const file of ["robots.txt", "sitemap.xml", "setup/index.html", "start/index.html"]) {
        const path = `/${file.replace(/index\.html$/, "")}`;
        const live = await new Promise<string>((resolve, reject) => {
          const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `live.localhost:${server.port}` } }, res => {
            let body = ""; res.setEncoding("utf8"); res.on("data", c => { body += c; }); res.on("end", () => resolve(body));
          });
          req.on("error", reject); req.end();
        });
        expect(live.replaceAll(`http://live.localhost:${server.port}/`, benchConfig.site!.url!), file).toBe(files.get(file)!.bytes.toString("utf8"));
      }
      // The workbench's own robots.txt, on its host: searchable, its previews not.
      const workbench = await new Promise<string>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: server.port, path: "/robots.txt", headers: { host: `pd.localhost:${server.port}` } }, res => {
          let body = ""; res.setEncoding("utf8"); res.on("data", c => { body += c; }); res.on("end", () => resolve(body));
        });
        req.on("error", reject); req.end();
      });
      expect(workbench).toBe("User-agent: *\nDisallow: /preview/\n");
    } finally { await server.close(); }
  }, 60_000);

  it("leaves the workbench snapshot exactly as a build without a storefront makes it, but for each layout's pages", async () => {
    // From the same copy: a compiled script's banner names its source path, so two copies' builds would
    // differ by where they are, whatever the storefront does.
    const { site: _sf, ...noStorefront } = benchConfig;
    await buildStaticSite(validateConfig(noStorefront, "test"), root, { outDir: join(root, "..", "wb-none"), pdVersion: "0.0.0-test", now: NOW });
    const a = await tree(join(root, "..", "wb-good"));
    const b = await tree(join(root, "..", "wb-none"));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    const differing = [...a].filter(([k, v]) => !v.bytes.equals(b.get(k)!.bytes)).map(([k]) => k);
    // A layout's detail lists the pages that render with it (relationships.pages), which only a site has: that, and
    // nothing else, differs.
    const layouts = ["article", "doc", "home", "listing", "page"].map(l => `api/component/layouts/${l}/index.json`);
    // The generated pages' layouts list the tag and category pages and their indexes, each with what generated it.
    const generated: Record<string, unknown[]> = {
      categories: [{ route: "/categories/", source: "generated", generated: { kind: "category" } }],
      category: ["design-systems", "guides"].map(t => ({ route: `/categories/${t}/`, source: "generated", generated: { kind: "category", term: t } })),
      tag: ["design", "images", "layout"].map(t => ({ route: `/tags/${t}/`, source: "generated", generated: { kind: "tag", term: t } })),
      tags: [{ route: "/tags/", source: "generated", generated: { kind: "tag" } }],
    };
    const generatedKeys = Object.keys(generated).map(l => `api/component/layouts/${l}/index.json`);
    expect(differing.sort()).toEqual([...layouts, ...generatedKeys].sort());
    for (const [l, pages] of Object.entries(generated)) {
      const k = `api/component/layouts/${l}/index.json`;
      const withSite = JSON.parse(a.get(k)!.bytes.toString("utf8")) as { relationships: { pages?: unknown[] } };
      expect(withSite.relationships.pages, k).toEqual(pages);
      delete withSite.relationships.pages;
      expect(withSite, k).toEqual(JSON.parse(b.get(k)!.bytes.toString("utf8")));
    }
    for (const k of layouts) {
      const withSite = JSON.parse(a.get(k)!.bytes.toString("utf8")) as { relationships: { pages?: unknown[] } };
      expect(withSite.relationships.pages?.length, k).toBeGreaterThan(0);
      delete withSite.relationships.pages;
      expect(withSite, k).toEqual(JSON.parse(b.get(k)!.bytes.toString("utf8")));
    }
  }, 120_000);
});

describe("pd build — a storefront with problems writes nothing", () => {
  const breakPage = (root: string) => append(join(root, "pages", "about.md"), "\n```pattern components/nope\n```\n");
  const brokenHome = async (root: string) => {
    const file = join(root, "pages", "index.md");
    await save(file, (await readFile(file, "utf8")).replace("title: Storefront bench", "title: Storefront bench\nbogus: 1"));
  };

  it("fails, listing every problem, and leaves no output root behind", async () => {
    const root = await benchCopy();
    await breakPage(root);
    await brokenHome(root);
    const out = join(root, "..", "wb-fail");
    await expect(build(root, out)).rejects.toThrow(
      "pd build: the site has problems, so nothing was written:\n"
      + `  - /: index.md:4: "bogus" is not declared by layout "home"\n`
      + "  - /about/: about.md: pattern components/nope: there is no such component",
    );
    expect(await exists(out)).toBe(false);
    expect(await exists(join(root, ".out", "storefront"))).toBe(false);
  }, 120_000);

  it("lists a problem of the whole site once, not once for every page that shows it", async () => {
    const root = await benchCopy();
    const site = { ...benchConfig.site!.globals!, navigations: { footer: [{ page: "nope.md" }] } };
    const out = join(root, "..", "wb-nav");
    const error = await build(root, out, config({ globals: site })).then(() => "", (e: Error) => e.message);
    const problem = `site.globals.navigations.footer[0]: "nope.md" is not a page in the pages folder`;
    expect(error).toBe(`pd build: the site has problems, so nothing was written:\n  - ${problem}`);
    expect(await exists(out)).toBe(false);
  }, 120_000);

  it("leaves both roots of an earlier build untouched", async () => {
    const root = await benchCopy();
    const out = join(root, "..", "wb-kept");
    await build(root, out);
    const before = { wb: await tree(out), sf: await tree(join(root, ".out", "storefront")) };
    await breakPage(root);
    await expect(build(root, out)).rejects.toThrow("pd build: the site has problems, so nothing was written:");
    const after = { wb: await tree(out), sf: await tree(join(root, ".out", "storefront")) };
    for (const which of ["wb", "sf"] as const) {
      expect([...after[which].keys()].sort(), which).toEqual([...before[which].keys()].sort());
      for (const [k, v] of before[which]) {
        expect(after[which].get(k)!.bytes.equals(v.bytes), `${which} ${k}`).toBe(true);
        expect(after[which].get(k)!.mtimeMs, `${which} ${k}`).toBe(v.mtimeMs);
      }
    }
  }, 120_000);
});
