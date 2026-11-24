// Social images, the card a page gets (social-images.ts, social-route.ts): which pages get one, its hash, where its
// bytes come from (the cache, else the card committed beside the pages folder), and what the head and the built site
// then carry. Nothing is rendered here: a card is a PNG already in the cache or the committed folder (the bytes
// below are made up by the test, never a real image), and its hash is read off the server (DevServer.socialCards).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "../src/index.js";
import { buildStaticSite } from "../src/static-build.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-social-card-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const json = (v: unknown) => JSON.stringify(v);
const fm = (lines: string[], body = "Text.") => `---\n${lines.join("\n")}\n---\n\n${body}\n`;
/** A PNG's signature and a byte of its own, standing for a card: what the route serves is compared, never decoded. */
const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n]);
/** A real PNG, `w` x `h`, one grey: generated here, for the site's image, which is read from its bytes. */
function realPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w, 128)])));
  return Buffer.concat([png(0).subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const FILES: Record<string, string> = {
  "src/patterns/layouts/page/page.hbs": "<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main>",
  "src/patterns/layouts/page/page.schema.json": json({ properties: { title: { type: "string" }, description: { type: "string" } } }),
  "src/patterns/partials/base/base.hbs": "<div>{{site.title}}</div>",
  "src/patterns/partials/base/base.schema.json": json({ properties: { site: { type: "object", properties: { title: { type: "string" } } } } }),
  "src/patterns/components/social-image/social-image.hbs":
    `<div class="card"><p>{{section}}</p><h1>{{shout title}}</h1><p>{{description}}</p><time>{{date}}</time><p>{{site.title}}</p>{{> components-badge}}</div>`,
  "src/patterns/components/social-image/social-image.schema.json": json({ properties: {
    title: { type: "string" }, description: { type: "string" }, section: { type: "string" }, date: { type: "string" },
    site: { type: "object" }, tone: { type: "string" } } }),
  "src/patterns/components/social-image/social-image~release.json": json({ tone: "dark" }),
  "src/patterns/components/social-image/social-image~release.hbs": `<div class="card card--{{tone}}"><h1>{{title}}</h1></div>`,
  "src/patterns/components/badge/badge.hbs": `<span class="badge">PD</span>`,
  "src/patterns/components/other/other.hbs": `<span class="other">x</span>`,
  "src/styles/components/social-image.scss": `.card { inline-size: 1200px; block-size: 630px; background: url(/assets/fonts/face.woff2); }\n`,
  "src/styles/components/other.scss": `.other { color: red; }\n`,
  "src/helpers/hbs.cjs": `module.exports = H => { H.registerHelper("shout", s => String(s).toUpperCase()); };\n`,
  // Made-up bytes, not a font: only its content stamp is read.
  "assets/fonts/face.woff2": "face-1",
  "assets/share.png": realPng(240, 126).toString("latin1"),
  "pages/index.md": fm(["title: Home"]),
  "pages/guide/index.md": fm(["title: Guide"]),
  "pages/guide/install.md": fm(["title: Install", "description: How to install.", "date: 2026-11-01"]),
  "pages/guide/news.md": fm(["title: News", "socialImage: release"]),
  "pages/about.md": fm(["title: About", "image: /assets/share.png"]),
  "pages/notes/index.md": fm(["title: Notes", "childDefaults:", "  image: /assets/share.png"]),
  "pages/notes/one.md": fm(["title: One"]),
  "pages/off.md": fm(["title: Off", "socialImage: false"]),
};

const configFor = (url = "https://example.test/", globals: Record<string, unknown> = { title: "Bench" }) => validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", helpers: "./src/helpers",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { strategy: "central", dir: "./assets" },
  site: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/", url, image: "/assets/share.png",
    globals, socialImages: { component: "components/social-image" } },
} as never), "test");

let n = 0;
async function project(files: Record<string, string | null> = {}): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries({ ...FILES, ...files })) {
    if (text === null) continue;
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), rel.endsWith(".png") ? Buffer.from(text, "latin1") : text);
  }
  return root;
}

const SITE = PD_HOSTS.storefront;
/** The social cache, by its path as the brief names it: a folder of its own beside the image variants'. */
const socialCacheDir = (root: string) => join(root, "node_modules", ".cache", "pattern-dump", "social");
function get(s: DevServer, path: string): Promise<{ status: number; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port: s.port, path, headers: { host: `${SITE}:${s.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
    }).on("error", reject).end();
  });
}
const text = async (s: DevServer, path: string) => (await get(s, path)).body.toString("utf8");
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1];

/** The project's server, for the length of `use`. */
async function withServer<T>(root: string, use: (s: DevServer) => Promise<T>, o: { version?: string; config?: ReturnType<typeof configFor> } = {}): Promise<T> {
  const s = await startDevServer(o.config ?? configFor(), root, { port: 0, live: false, ...(o.version ? { version: o.version } : {}) });
  try { return await use(s); } finally { await s.close(); }
}
/** The hash of the card the page at `route` gets, its head served once. */
const hashOf = (root: string, route = "/guide/install/", o: { version?: string; config?: ReturnType<typeof configFor> } = {}) =>
  withServer(root, async s => {
    const res = await get(s, route);
    expect(res.status, res.body.toString("utf8")).toBe(200);
    return s.socialCards().find(c => c.route === route)?.hash;
  }, o);

describe("which pages get a card", () => {
  it("a page without an image; not one with its own, one from childDefaults, socialImage: false, or the 404 page", async () => {
    const root = await project();
    await withServer(root, async s => {
      for (const route of ["/", "/guide/", "/guide/install/", "/guide/news/", "/about/", "/notes/one/", "/off/", "/404.html"]) await get(s, route);
      expect(s.socialCards().map(c => [c.route, c.variant]).sort()).toEqual([
        ["/", "components/social-image"], ["/guide/", "components/social-image"],
        ["/guide/install/", "components/social-image"], ["/guide/news/", "components/social-image~release"],
      ]);
    });
  });

  it("without a card's bytes, the page keeps the site's image", async () => {
    const root = await project();
    await withServer(root, async s => {
      const html = await text(s, "/guide/install/");
      expect(meta(html, "og:image")).toMatch(/^https:\/\/example\.test\/assets\/share\.png\?v=/);
      expect(meta(html, "og:image:width")).not.toBe("1200");
    });
  });

  it("a field the component requires and the page lacks fails the page, naming page, field and schema", async () => {
    const root = await project({ "src/patterns/components/social-image/social-image.schema.json": json({
      required: ["title", "description"], properties: { title: { type: "string" }, description: { type: "string" } } }) });
    await withServer(root, async s => {
      expect((await get(s, "/guide/install/")).status).toBe(200);
      const res = await get(s, "/guide/");
      expect(res.status).toBe(500);
      expect(res.body.toString("utf8")).toContain(
        `guide/index.md: the social image needs "description", which components/social-image requires (social-image.schema.json): give the page a description, or set socialImage: false`);
    });
  });
});

describe("the hash: what decides the picture, and nothing else", () => {
  let root = "";
  let base: string | undefined;
  beforeAll(async () => { root = await project(); base = await hashOf(root); });

  it("is 10 hex digits, the same for the same inputs", async () => {
    expect(base).toMatch(/^[0-9a-f]{10}$/);
    expect(await hashOf(await project())).toBe(base);
  });

  const changes: Array<[string, Record<string, string>, string?]> = [
    ["the template", { "src/patterns/components/social-image/social-image.hbs": FILES["src/patterns/components/social-image/social-image.hbs"]!.replace("<time>", "<time class=\"d\">") }],
    ["a partial it includes", { "src/patterns/components/badge/badge.hbs": `<span class="badge">PD 2</span>` }],
    ["a helper it uses", { "src/helpers/hbs.cjs": `module.exports = H => { H.registerHelper("shout", s => String(s).toUpperCase() + "!"); };\n` }],
    ["its stylesheet", { "src/styles/components/social-image.scss": `.card { inline-size: 1200px; block-size: 630px; color: navy; background: url(/assets/fonts/face.woff2); }\n` }],
    ["a font its stylesheet loads", { "assets/fonts/face.woff2": "face-2" }],
    ["the title", { "pages/guide/install.md": fm(["title: Installing", "description: How to install.", "date: 2026-11-01"]) }],
    ["the description", { "pages/guide/install.md": fm(["title: Install", "description: How to set it up.", "date: 2026-11-01"]) }],
    ["the date", { "pages/guide/install.md": fm(["title: Install", "description: How to install.", "date: 2026-11-02"]) }],
    ["the section", { "pages/guide/index.md": fm(["title: Guides"]) }],
    ["the variant's data", { "src/patterns/components/social-image/social-image~release.json": json({ tone: "light" }) }, "/guide/news/"],
  ];
  for (const [what, files, route] of changes) {
    it(`changes with ${what}`, async () => {
      const r = route ?? "/guide/install/";
      expect(await hashOf(await project(files), r)).not.toBe(route ? await hashOf(root, r) : base);
    });
  }

  it("changes with the site's globals", async () => {
    expect(await hashOf(root, "/guide/install/", { config: configFor(undefined, { title: "Other" }) })).not.toBe(base);
  });

  it("changes with Pattern Dump's version", async () => {
    expect(await hashOf(root, "/guide/install/", { version: "9.9.9" })).not.toBe(base);
  });

  it("doesn't change with another component's stylesheet, or another page's text", async () => {
    expect(await hashOf(await project({
      "src/styles/components/other.scss": `.other { color: blue; }\n`,
      "pages/guide/news.md": fm(["title: News, later", "socialImage: release"]),
    }))).toBe(base);
  });
});

describe("where a card's bytes come from, and what carries it", () => {
  it("a committed card at its hash: the head names it, under the site's path; the route serves it", async () => {
    const root = await project();
    const config = configFor("https://example.test/docs/");
    // Asked for under the site's path; the card is named by the site path.
    const hash = (await withServer(root, async s => { await get(s, "/docs/guide/install/"); return s.socialCards().find(c => c.route === "/guide/install/")?.hash; }, { config }))!;
    expect(hash).toMatch(/^[0-9a-f]{10}$/);
    await save(join(root, "social", "guide", "install", `card.${hash}.png`), png(7));
    await withServer(root, async s => {
      const html = await text(s, "/docs/guide/install/");
      const url = `https://example.test/docs/_pd/social/guide/install/card.${hash}.png`;
      expect(meta(html, "og:image")).toBe(url);
      expect(meta(html, "og:image:width")).toBe("1200");
      expect(meta(html, "og:image:height")).toBe("630");
      expect(meta(html, "twitter:image")).toBe(url);
      expect(meta(html, "twitter:card")).toBe("summary_large_image");
      const card = await get(s, `/docs/_pd/social/guide/install/card.${hash}.png`);
      expect([card.status, card.type, [...card.body]]).toEqual([200, "image/png", [...png(7)]]);
      expect((await get(s, `/docs/_pd/social/guide/install/card.0000000000.png`)).status).toBe(404);
      expect((await get(s, `/docs/_pd/social/guide/card.${hash}.png`)).status).toBe(404);
    }, { config });
  });

  it("a card in the cache: served from there", async () => {
    const root = await project();
    const hash = (await hashOf(root))!;
    await save(join(socialCacheDir(root), `${hash}.png`), png(9));
    await withServer(root, async s => {
      expect(meta(await text(s, "/guide/install/"), "og:image")).toBe(`https://example.test/_pd/social/guide/install/card.${hash}.png`);
      expect([...(await get(s, `/_pd/social/guide/install/card.${hash}.png`)).body]).toEqual([...png(9)]);
    });
  });

  it("pd build writes the card a page names, with its own version in the hash, and the social cache keeps only what it wrote", async () => {
    const root = await project();
    // The build's server hashes with the build's version: a card made for another version isn't this build's.
    const hash = (await hashOf(root, "/guide/install/", { version: "1.2.3" }))!;
    const cache = socialCacheDir(root);
    const images = join(root, "node_modules", ".cache", "pattern-dump", "images");
    await save(join(cache, `${hash}.png`), png(3));
    await save(join(cache, "0123456789.png"), png(4));
    await save(join(images, "abcdefabcd.webp"), "kept");
    await buildStaticSite(configFor(), root, { outDir: join(root, "dist"), pdVersion: "1.2.3" });
    const built = join(root, "site", "_pd", "social", "guide", "install", `card.${hash}.png`);
    expect([...await readFile(built)]).toEqual([...png(3)]);
    expect(meta(await readFile(join(root, "site", "guide", "install", "index.html"), "utf8"), "og:image"))
      .toBe(`https://example.test/_pd/social/guide/install/card.${hash}.png`);
    expect(await readdir(cache)).toEqual([`${hash}.png`]);
    expect(existsSync(join(images, "abcdefabcd.webp"))).toBe(false); // the images cache keeps only its own: none used
    expect(await readdir(join(root, "site", "_pd", "social"), { recursive: true })).toContain(join("guide", "install", `card.${hash}.png`));
  });
});
