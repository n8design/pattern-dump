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
import { defineConfig, validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { buildStaticSite, startDevServer } from "@pattern-dump/dev-server";
import { relativeUrls } from "../src/storefront/page.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

/** Append `text` to `path`, as one save of the whole file. */
const append = async (path: string, text: string) => save(path, `${await readFile(path, "utf8")}${text}`);

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = new Date("2026-01-02T03:04:05.000Z");
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
const config = (over: Partial<NonNullable<PatternDumpConfig["storefront"]>> = {}): PatternDumpConfig =>
  validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, ...over } }, "test");
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
      "_pd/components/components/callout.css",
      "_pd/components/components/card.css",
      "_pd/components/components/slide.css",
      "_pd/components/components/slider.css",
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
      "guides/index.html",
      "guides/setup/index.html",
      "index.html",
      "preview/components/callout/index.html",
      "preview/components/callout~warning/index.html",
      "robots.txt",
      // The pages that forward from guides/setup.md's old routes.
      "setup/index.html",
      "sitemap.xml",
      "start/index.html",
    ]);
    expect(report.storefront).toEqual({ outDir: join(root, ".out", "storefront"), basePath: "/", pages: 7, files: 38, bytes: expect.any(Number) });
  });

  it("notes a heading whose anchor the layout has, and leaves nothing out for it", () => {
    // The bench copy is outside any repository, so its doc layout's dates are null, noted once.
    expect(report.notes).toEqual([
      "the pages folder is not in a git repository: no page has dates",
      `guides/setup.md: heading "Main" is #main-1, because the layout uses id="main"`,
      // The bench's one link to another host, listed by the link check, not fetched.
      `an external link, not checked: https://example.test/source (on /, /guides/, /guides/setup/, /about/, /articles/, /articles/harbour/, /articles/plain/, /404.html)`,
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

  it("links into the workbench at storefront.workbenchUrl, and carries no live-reload client and no shell CSS", () => {
    const setup = files.get("guides/setup/index.html")!.bytes.toString("utf8");
    expect(setup).toContain(`href="${WB}components/callout#warning"`);
    expect(setup).not.toContain("pd.localhost");
    for (const [file, { bytes }] of files) {
      expect(bytes.toString("utf8"), file).not.toContain("data-pd-live");
      expect(bytes.toString("utf8"), file).not.toContain("/_pd/main.css");
    }
  });

  it("with storefront.url: canonical and og:url on every page at the configured address, and no note about it", () => {
    expect(report.notes.some(n => n.startsWith("storefront.url is not set"))).toBe(false);
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
    // characters. The copy is outside any repository, so no page has a date and none has a <lastmod>.
    expect(sitemap.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`)).toBe(true);
    const locs = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><\/url>/g)].map(m => m[1]!);
    expect(locs).toEqual(["https://bench.example.test/", "https://bench.example.test/about/", "https://bench.example.test/articles/",
      "https://bench.example.test/articles/harbour/", "https://bench.example.test/articles/plain/", "https://bench.example.test/guides/", "https://bench.example.test/guides/setup/"]);
    expect(sitemap.match(/<url>/g)).toHaveLength(locs.length);
    for (const loc of locs) expect(loc.length).toBeLessThanOrEqual(2048);
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
          .replaceAll(`http://live.localhost:${server.port}/`, benchConfig.storefront!.url!);
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
        expect(live.replaceAll(`http://live.localhost:${server.port}/`, benchConfig.storefront!.url!), file).toBe(files.get(file)!.bytes.toString("utf8"));
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

  it("leaves the workbench snapshot exactly as a build without a storefront makes it", async () => {
    // From the same copy: a compiled script's banner names its source path, so two copies' builds would
    // differ by where they are, whatever the storefront does.
    const { storefront: _sf, ...noStorefront } = benchConfig;
    await buildStaticSite(validateConfig(noStorefront, "test"), root, { outDir: join(root, "..", "wb-none"), pdVersion: "0.0.0-test", now: NOW });
    const a = await tree(join(root, "..", "wb-good"));
    const b = await tree(join(root, "..", "wb-none"));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    const differing = [...a].filter(([k, v]) => !v.bytes.equals(b.get(k)!.bytes)).map(([k]) => k);
    expect(differing).toEqual([]);
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
      "pd build: the storefront has problems, so nothing was written:\n"
      + `  - /: index.md:4: "bogus" is not declared by layout "home"\n`
      + "  - /about/: about.md: pattern components/nope: there is no such component",
    );
    expect(await exists(out)).toBe(false);
    expect(await exists(join(root, ".out", "storefront"))).toBe(false);
  }, 120_000);

  it("lists a problem of the whole site once, not once for every page that shows it", async () => {
    const root = await benchCopy();
    const site = { ...benchConfig.storefront!.site!, navigations: { footer: [{ page: "nope.md" }] } };
    const out = join(root, "..", "wb-nav");
    const error = await build(root, out, config({ site })).then(() => "", (e: Error) => e.message);
    const problem = `storefront.site.navigations.footer[0]: "nope.md" is not a page in the pages folder`;
    expect(error).toBe(`pd build: the storefront has problems, so nothing was written:\n  - ${problem}`);
    expect(await exists(out)).toBe(false);
  }, 120_000);

  it("leaves both roots of an earlier build untouched", async () => {
    const root = await benchCopy();
    const out = join(root, "..", "wb-kept");
    await build(root, out);
    const before = { wb: await tree(out), sf: await tree(join(root, ".out", "storefront")) };
    await breakPage(root);
    await expect(build(root, out)).rejects.toThrow("pd build: the storefront has problems, so nothing was written:");
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

describe("pd build — the storefront's settings", () => {
  it("needs storefront.workbenchUrl, and writes nothing without it", async () => {
    const root = await benchCopy();
    const { workbenchUrl: _w, ...rest } = benchConfig.storefront!;
    const out = join(root, "..", "wb-nourl");
    await expect(buildStaticSite(validateConfig({ ...benchConfig, storefront: rest }, "test"), root, { outDir: out, pdVersion: "x" }))
      .rejects.toThrow("pd build: storefront.workbenchUrl is required to build the storefront — its pages link into the workbench at that address");
    expect(await exists(out)).toBe(false);
  });

  it("without storefront.url: no canonical, Open Graph or card, and one note for the whole build", async () => {
    const root = await benchCopy();
    const { url: _u, ...rest } = benchConfig.storefront!;
    const report = await buildStaticSite(validateConfig({ ...benchConfig, storefront: rest }, "test"), root,
      { outDir: join(root, "..", "wb-nosite"), pdVersion: "x", now: NOW });
    const note = `storefront.url is not set, so pages have no canonical URL, og:url, og:image or JSON-LD, `
      + `and there is no sitemap: set storefront.url to the site's address, such as "https://example.com/"`;
    expect(report.notes.filter(n => n === note)).toHaveLength(1);
    const pages = await tree(join(root, ".out", "storefront"));
    for (const [file, { bytes }] of pages) {
      if (file.endsWith(".html")) expect(bytes.toString("utf8"), file).not.toMatch(/rel="canonical"|property="og:|name="twitter:/);
    }
  }, 60_000);

  it("fails on an old route that is a page, naming it, and writes nothing", async () => {
    const root = await benchCopy();
    const about = join(root, "pages", "about.md");
    await save(about, (await readFile(about, "utf8")).replace("title: About\n", "title: About\nredirectFrom: /guides/\n"));
    const out = join(root, "..", "wb-redirect-page");
    await expect(build(root, out)).rejects.toThrow(`about.md:4: redirectFrom "/guides/" is the page guides/index.md: a route can't both be a page and forward to one`);
    expect(await exists(out)).toBe(false);
  }, 60_000);

  it("fails on a 404 page with a relative URL, naming it, and writes nothing", async () => {
    const root = await benchCopy();
    await save(join(root, "pages", "404.md"), "---\ntitle: Lost\n---\n\nTry [the guides](./guides/).\n");
    const out = join(root, "..", "wb-rel404");
    await expect(build(root, out)).rejects.toThrow(`the 404 page (404.md): the URL "./guides/" is relative, and the 404 page is served at every address, `
      + `so it only works from the site's root: use "/guides/" instead`);
    expect(await exists(out)).toBe(false);
  }, 60_000);

  it("leaves a page with index: false out of the sitemap", async () => {
    const root = await benchCopy();
    const setup = join(root, "pages", "guides", "setup.md");
    await save(setup, (await readFile(setup, "utf8")).replace("title: Setup\n", "title: Setup\nindex: false\n"));
    await build(root, join(root, "..", "wb-noindex"));
    const out = join(root, ".out", "storefront");
    const sitemap = await readFile(join(out, "sitemap.xml"), "utf8");
    expect(sitemap).not.toContain("/guides/setup/");
    expect(sitemap).toContain("<loc>https://bench.example.test/guides/</loc>");
    expect(await readFile(join(out, "guides", "setup", "index.html"), "utf8")).toContain(`<meta name="robots" content="noindex">`);
  }, 60_000);

  it("a site with index: false: no sitemap, and robots.txt keeps everything out", async () => {
    const root = await benchCopy();
    await build(root, join(root, "..", "wb-staging"), config({ index: false }));
    const out = join(root, ".out", "storefront");
    expect(await exists(join(out, "sitemap.xml"))).toBe(false);
    expect(await readFile(join(out, "robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /\n");
  }, 60_000);

  it("without storefront.url: no sitemap, and robots.txt names none", async () => {
    const root = await benchCopy();
    const { url: _u, ...rest } = benchConfig.storefront!;
    await buildStaticSite(validateConfig({ ...benchConfig, storefront: rest }, "test"), root, { outDir: join(root, "..", "wb-nourl2"), pdVersion: "x", now: NOW });
    const out = join(root, ".out", "storefront");
    expect(await exists(join(out, "sitemap.xml"))).toBe(false);
    expect(await readFile(join(out, "robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /preview/\n");
  }, 60_000);

  // A workbench published on the storefront's own host (storefront.workbenchUrl a path, or an absolute URL on
  // storefront.url's origin): its previews are kept out by the storefront's robots.txt, at the host's root, so
  // the build no longer asks for its rule to be copied there.
  const sameHostNote = "robots.txt is written to the workbench's root, but crawlers read it only at a host's root: "
    + "with the base path /workbench/, each preview carries a robots noindex tag instead; where you can, also add its rule "
    + "(Disallow: /workbench/preview/) to the robots.txt the host serves at /";
  const buildAt = (root: string, out: string, cfg: PatternDumpConfig) =>
    buildStaticSite(cfg, root, { outDir: out, basePath: "/workbench/", pdVersion: "0.0.0-test", now: NOW });

  it("a workbench at a path on the storefront's host: robots.txt keeps its previews out, and the build asks nothing", async () => {
    const root = await benchCopy();
    const report = await buildAt(root, join(root, "..", "wb-samehost"), config({ workbenchUrl: "/workbench/" }));
    expect(await readFile(join(root, ".out", "storefront", "robots.txt"), "utf8"))
      .toBe("User-agent: *\nDisallow: /preview/\nDisallow: /workbench/preview/\n\nSitemap: https://bench.example.test/sitemap.xml\n");
    expect(report.notes).not.toContain(sameHostNote);
  }, 60_000);

  it("an absolute workbenchUrl on the site's own origin counts as the same host", async () => {
    const root = await benchCopy();
    const report = await buildAt(root, join(root, "..", "wb-sameorigin"), config({ workbenchUrl: "https://bench.example.test/workbench/" }));
    expect(await readFile(join(root, ".out", "storefront", "robots.txt"), "utf8")).toContain("Disallow: /workbench/preview/\n");
    expect(report.notes).not.toContain(sameHostNote);
  }, 60_000);

  it("a workbench on a host of its own: no line for it, and the build still says where its rule must go", async () => {
    const root = await benchCopy();
    const report = await buildAt(root, join(root, "..", "wb-ownhost"), config({ workbenchUrl: "https://workbench.example.test/workbench/" }));
    expect(await readFile(join(root, ".out", "storefront", "robots.txt"), "utf8"))
      .toBe("User-agent: *\nDisallow: /preview/\n\nSitemap: https://bench.example.test/sitemap.xml\n");
    expect(report.notes).toContain(sameHostNote);
  }, 60_000);

  it("fails on a page where the same-host workbench is published, naming it, and writes nothing", async () => {
    const root = await benchCopy();
    await save(join(root, "pages", "workbench.md"), "---\ntitle: Workbench\n---\n\nA page in the workbench's place.\n");
    const out = join(root, "..", "wb-taken");
    await expect(buildAt(root, out, config({ workbenchUrl: "/workbench/" })))
      .rejects.toThrow(`workbench.md: the page /workbench/ is at /workbench/, where the workbench is published on this host (storefront.workbenchUrl), so the workbench would overwrite it there`);
    expect(await exists(out)).toBe(false);
  }, 60_000);

  // A same-host workbench is linked at its path, so the build must make it for that path.
  const builtFor = (got: string) => `pd build: storefront.workbenchUrl is /workbench/, so the workbench must be built for /workbench/ `
    + `(build.basePath or --base); it is being built for ${got}`;
  const withBase = (basePath: string | undefined) => validateConfig({ ...benchConfig, ...(basePath ? { build: { basePath } } : {}),
    storefront: { ...benchConfig.storefront!, workbenchUrl: "/workbench/" } }, "test");

  it("fails when the base path in the config is not the same-host workbench's path, and writes nothing", async () => {
    const root = await benchCopy();
    const out = join(root, "..", "wb-base-config");
    await expect(build(root, out, withBase("/docs/"))).rejects.toThrow(builtFor("/docs/"));
    expect(await exists(out)).toBe(false);
  }, 60_000);

  it("fails when --base overrides a matching build.basePath with another path", async () => {
    const root = await benchCopy();
    const out = join(root, "..", "wb-base-flag");
    await expect(buildStaticSite(withBase("/workbench/"), root, { outDir: out, basePath: "/docs/", pdVersion: "0.0.0-test", now: NOW }))
      .rejects.toThrow(builtFor("/docs/"));
    expect(await exists(out)).toBe(false);
  }, 60_000);

  it("fails when no base path is given at all: the workbench would be built for /", async () => {
    const root = await benchCopy();
    await expect(build(root, join(root, "..", "wb-base-none"), withBase(undefined))).rejects.toThrow(builtFor("/"));
  }, 60_000);

  it("builds when --base names the same-host path in another spelling, and when build.basePath alone gives it", async () => {
    const root = await benchCopy();
    await buildStaticSite(withBase(undefined), root, { outDir: join(root, "..", "wb-base-spelled"), basePath: "/workbench", pdVersion: "0.0.0-test", now: NOW });
    await build(root, join(root, "..", "wb-base-cfg-ok"), withBase("/workbench/"));
  }, 60_000);

  it("keeps the storefront's output apart from the workbench's and from what PD reads", async () => {
    const root = await benchCopy();
    await expect(build(root, join(root, ".out", "storefront"))).rejects.toThrow(/and --out .* overlap — the storefront and the workbench each need a folder of their own/);
    await expect(build(root, join(root, "..", "wb-x"), config({ outDir: "./src/styles/out" }))).rejects.toThrow(/storefront\.outDir .* overlaps .*styles, which Pattern Dump reads/);
    // An output root that contains the project is already refused by the config (it holds the pages and the
    // patterns); the build refuses it too, for a config that never went through validation.
    expect(() => config({ outDir: "." })).toThrow(/"storefront\.pagesDir" \("\.\/pages"\) is inside "storefront\.outDir" \("\."\)/);
    const unvalidated = defineConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, outDir: "." } });
    await expect(build(root, join(root, "..", "wb-y"), unvalidated)).rejects.toThrow(/storefront\.outDir .* would contain the project itself/);
  });
});
