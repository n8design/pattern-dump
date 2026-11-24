// Images beside a site's pages, end to end through the server pd build crawls: a relative image in a page's markdown
// is served with its variants under /_pd/images/<its path>, the original at its own path (/guide/chart.png), and
// pd build writes only what a page references, each file once, under the site's base path. An asset and a page
// image may share a variant name (assets/guide/shot.png, pages/guide/shot.png): different bytes give different
// hashes and both are served and written; identical bytes give one shared set of variants, on purpose.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
const SLOT = { widths: [160, 320], sizes: "100vw" };
// An SVG written here, for the test: a rectangle at a known size.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32"><rect width="64" height="32"/></svg>\n`;
const LAYOUT = {
  "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
  "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } }, "x-pd-prose-images": SLOT }),
};
const configFor = (url: string) => validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  storefront: { pagesDir: "./pages", outDir: "./site", url, workbenchUrl: "https://wb.test/" },
}), "page-images");
const SITE = PD_HOSTS.storefront;

let tmp = "";
const servers: DevServer[] = [];
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-page-images-site-")); });
afterAll(async () => {
  await Promise.all(servers.map(s => s.close()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

/** A project: text files saved, `{ copy }` entries copied from the image fixtures. */
async function project(name: string, files: Record<string, string | { copy: string }>): Promise<string> {
  const root = join(tmp, name);
  for (const [rel, body] of Object.entries({ ...LAYOUT, ...files })) {
    const to = join(root, rel);
    if (typeof body === "string") { await save(to, body); continue; }
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(fixtures, body.copy), to);
  }
  return root;
}

async function serve(root: string): Promise<DevServer> {
  const server = await startDevServer(configFor("https://site.test/"), root, { port: 0, live: false });
  servers.push(server);
  return server;
}

function get(server: DevServer, path: string): Promise<{ status: number; type: string; bytes: Buffer; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${SITE}:${server.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), bytes, body: bytes.toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** Every URL an <img> or <source> asks for: its src and each srcset candidate. */
const imageUrls = (html: string): string[] => [
  ...[...html.matchAll(/<img [^>]*\bsrc="([^"]+)"/g)].map(m => m[1]!),
  ...[...html.matchAll(/\bsrcset="([^"]+)"/g)].flatMap(m => m[1]!.split(",").map(c => c.trim().split(/\s+/)[0]!)),
];

const build = async (root: string, url = "https://site.test/") => {
  const report = await buildStaticSite(configFor(url), root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test" });
  return { site: join(root, "site"), pages: report.storefront?.pages };
};

describe("images beside the pages", () => {
  let root = "";
  let server: DevServer;
  beforeAll(async () => {
    root = await project("beside", {
      "pages/index.md": `---\ntitle: Home\n---\n\n![The pad at dawn](shot.jpg "The pad, at dawn")\n\n![Sales again](guide/chart.png)\n\n`
        + `![A banner](shared/banner.png)\n\n![The flow](shared/diagram.svg)\n`,
      "pages/shot.jpg": { copy: "photo.jpg" },
      "pages/guide/index.md": `---\ntitle: Guide\nimage: ./chart.png\n---\n\n![Sales by month](./chart.png)\n\n![A banner](../shared/banner.png)\n\n`
        + `![The flow](../shared/diagram.svg)\n`,
      "pages/guide/chart.png": { copy: "flat.png" },
      "pages/guide/chart-dark.png": { copy: "alpha.png" },
      "pages/shared/banner.png": { copy: "photo.jpg" },
      "pages/shared/diagram.svg": SVG,
      "pages/unused.png": { copy: "flat.png" },
      "pages/outside.md": `---\ntitle: Outside\n---\n\n![Out of the folder](../outside.png)\n`,
      "pages/missing.md": `---\ntitle: Missing\n---\n\nText.\n\n![Gone](./gone.png)\n`,
    });
    server = await serve(root);
  });

  it("a relative image in the top folder: its variants under /_pd/images/, a caption, each served", async () => {
    const page = await get(server, "/");
    expect(page.status).toBe(200);
    const figure = /<figure class="doc-figure">[\s\S]*?<\/figure>/.exec(page.body)?.[0] ?? "";
    expect(figure).toMatch(/^<figure class="doc-figure">\n<img src="\/_pd\/images\/shot\.[0-9a-f]{10}\.320\.webp" /);
    expect(figure).toContain(`<figcaption>The pad, at dawn</figcaption>`);
    const urls = imageUrls(figure);
    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) {
      const r = await get(server, url);
      expect([r.status, r.type], url).toEqual([200, "image/webp"]);
    }
  });

  it("in a nested folder: a -dark pair as a <picture>, the og:image, and the original at its own path", async () => {
    const page = await get(server, "/guide/");
    expect(page.status).toBe(200);
    expect(page.body).toMatch(/<picture><source media="\(prefers-color-scheme: dark\)" srcset="\/_pd\/images\/guide\/chart-dark\.[0-9a-f]{10}\.\d+\.webp/);
    for (const url of imageUrls(page.body)) expect((await get(server, url)).status, url).toBe(200);
    expect(page.body).toMatch(/<meta property="og:image" content="https?:\/\/[^"]+\/guide\/chart\.png(\?v=[^"]+)?">/);
    const original = await get(server, "/guide/chart.png");
    expect([original.status, original.type]).toEqual([200, "image/png"]);
    expect(original.bytes.equals(await readFile(join(root, "pages", "guide", "chart.png")))).toBe(true);
  });

  it("an SVG through ../ inside the pages folder: one file at its own size, served", async () => {
    const page = await get(server, "/guide/");
    expect(page.body).toMatch(/<img src="\/shared\/diagram\.svg\?v=[0-9a-f]+" width="64" height="32" alt="The flow"/);
    const svg = await get(server, "/shared/diagram.svg");
    expect([svg.status, svg.type.split(";")[0]]).toEqual([200, "image/svg+xml"]);
  });

  it("a relative image leaving the pages folder fails the page, at its line", async () => {
    const page = await get(server, "/outside/");
    expect(page.status).toBe(500);
    expect(page.body).toContain(`outside.md:5: the image ../outside.png is outside the pages folder: a relative image stays inside site.pagesDir `
      + `(an image from elsewhere goes in the assets, as /assets/…)`);
  });

  it("a missing relative image fails the page, naming the resolved path", async () => {
    const page = await get(server, "/missing/");
    expect(page.status).toBe(500);
    expect(page.body).toContain(`missing.md:7: the image ./gone.png is not beside the page: there is no gone.png in the pages folder`);
  });

  // Last: it removes the two pages that fail, which a build would stop on.
  it("pd build writes what the pages reference, once, under the site's base path", async () => {
    await rm(join(root, "pages", "outside.md"));
    await rm(join(root, "pages", "missing.md"));
    const { site, pages } = await build(root, "https://site.test/docs/");
    expect(pages, "the images are files, not pages").toBe(2);
    const home = await readFile(join(site, "index.html"), "utf8");
    expect(home).toMatch(/<img src="\/docs\/_pd\/images\/shot\.[0-9a-f]{10}\.320\.webp" /);
    expect(home).toMatch(/<img src="\/docs\/shared\/diagram\.svg\?v=[0-9a-f]+" width="64"/);
    expect(home).not.toMatch(/src="\/(?!docs\/)/);
    // The SVG and the og:image are referenced as files; a raster in a page's markdown only by its variants; an image no
    // page references is not written.
    expect(await readFile(join(site, "shared", "diagram.svg"), "utf8")).toBe(SVG);
    expect((await readFile(join(site, "guide", "chart.png"))).equals(await readFile(join(root, "pages", "guide", "chart.png")))).toBe(true);
    const top = await readdir(site);
    expect(top).not.toContain("unused.png");
    expect(top).not.toContain("shot.jpg");
    // One image from two pages, by two relative paths (shared/banner.png, ../shared/banner.png; guide/chart.png,
    // ./chart.png): both pages ask for the same variant URLs, and the build writes that one set, each file once.
    const guide = await readFile(join(site, "guide", "index.html"), "utf8");
    const named = (html: string, stem: string) => [...new Set(imageUrls(html).filter(u => u.includes(`/${stem}.`)).map(u => u.split("/").pop()!))].sort();
    for (const [folder, stem] of [["shared", "banner"], ["guide", "chart"]] as const) {
      expect(named(home, stem).length, stem).toBeGreaterThan(0);
      expect(named(guide, stem), stem).toEqual(named(home, stem));
      const written = (await readdir(join(site, "_pd", "images", folder))).filter(f => f.startsWith(`${stem}.`)).sort();
      expect(written, stem).toEqual(named(home, stem));
    }
  }, 120_000);
});

describe("an asset and a page image with the same variant name", () => {
  const files = (asset: string, page: string) => ({
    "src/assets/guide/shot.png": { copy: asset },
    "pages/guide/shot.png": { copy: page },
    "pages/index.md": `---\ntitle: Home\n---\n\n![From the assets](/assets/guide/shot.png)\n`,
    "pages/guide/index.md": `---\ntitle: Guide\n---\n\n![From beside the page](./shot.png)\n`,
  });
  const variantsOf = async (server: DevServer, route: string) => {
    const page = await get(server, route);
    expect(page.status, route).toBe(200);
    const urls = imageUrls(page.body);
    for (const url of urls) {
      expect(url, route).toMatch(/^\/_pd\/images\/guide\/shot\.[0-9a-f]{10}\.\d+\.webp$/);
      expect((await get(server, url)).status, url).toBe(200);
    }
    return urls;
  };

  it("different bytes: each page shows its own image, with its own hash, and the build writes both", async () => {
    const root = await project("collide-different", files("flat.png", "alpha.png"));
    const server = await serve(root);
    const fromAssets = await variantsOf(server, "/");
    const beside = await variantsOf(server, "/guide/");
    // No URL in common: each width's hash is its own source's, and so are the bytes served.
    expect(fromAssets.filter(u => beside.includes(u))).toEqual([]);
    expect((await get(server, fromAssets[0]!)).bytes.equals((await get(server, beside[0]!)).bytes)).toBe(false);
    const { site } = await build(root);
    const written = (await readdir(join(site, "_pd", "images", "guide"))).sort();
    const file = (u: string) => u.split("/").pop()!;
    expect(written).toEqual([...new Set([...fromAssets, ...beside].map(file))].sort());
  }, 120_000);

  it("identical bytes: one shared set of variants, written once, and both pages show it", async () => {
    const root = await project("collide-same", files("flat.png", "flat.png"));
    const server = await serve(root);
    const fromAssets = await variantsOf(server, "/");
    const beside = await variantsOf(server, "/guide/");
    expect(beside).toEqual(fromAssets);
    const { site } = await build(root);
    const written = (await readdir(join(site, "_pd", "images", "guide"))).sort();
    expect(written).toEqual([...new Set(fromAssets.map(u => u.split("/").pop()!))].sort());
  }, 120_000);
});
