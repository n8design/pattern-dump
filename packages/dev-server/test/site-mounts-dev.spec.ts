// pd dev with site mounts (site.mounts), over copies of mounts-bench: each mounted file at its route with its content
// type and its bytes as on disk (HTML, CSS and JS too, which pd dev rewrites for its own pages), under a base path as
// well; an edited file in the next response; a missing folder warned once, the 404 page, then served once built; a
// file in the place of the site's own left to the site, with one warning.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { startDevServer } from "../src/index.js";
import benchConfig from "../../../mounts-bench/site/pattern-dump.config.js";
import { writeImages } from "../../../mounts-bench/make-images.js";
import { save } from "../../../test-support/save.js";

const bench = fileURLToPath(new URL("../../../mounts-bench/", import.meta.url));
let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-mounts-dev-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });
afterEach(() => { vi.restoreAllMocks(); });

let n = 0;
async function copy(): Promise<string> {
  const dir = join(tmp, `d${n++}`);
  await cp(bench, dir, { recursive: true, filter: src => !/[/\\](?:\.out|dist|node_modules)$/.test(src) });
  await writeImages(dir);
  return dir;
}
type Site = NonNullable<PatternDumpConfig["storefront"]>;
const config = (over: Partial<Site> = {}): PatternDumpConfig => {
  const cfg = validateConfig(benchConfig, "test");
  return { ...cfg, storefront: { ...cfg.storefront!, ...over } };
};
const serve = (dir: string, cfg = config()) =>
  startDevServer(cfg, join(dir, "site"), { port: 0, wsPort: 0, live: true, today: "2026-11-25" });

interface Got { status: number; type: string; location: string; body: Buffer }
const get = (port: number, path: string) => new Promise<Got>((resolve, reject) => {
  request({ host: "127.0.0.1", port, path, headers: { host: `live.localhost:${port}` } }, res => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""),
      location: String(res.headers["location"] ?? ""), body: Buffer.concat(chunks) }));
  }).on("error", reject).end();
});
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function files(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true, withFileTypes: true })).filter(e => e.isFile())
    .map(e => relative(dir, join(e.parentPath, e.name)).split(sep).join("/")).sort();
}

const TYPES: Record<string, string> = {
  "tool/index.html": "text/html", "tool/style.css": "text/css", "tool/app.js": "application/javascript",
  "tool/logo.png": "image/png", "tool/sitemap.xml": "application/xml", "root/favicon.ico": "image/x-icon",
  "root/manifest.webmanifest": "application/manifest+json", "root/123456/x.css": "text/css",
};

for (const base of ["/", "/bench/"]) {
  describe(`every mounted file, byte for byte, with the site at ${base}`, () => {
    it("is served at its route with its content type, the bytes on disk", { timeout: 60_000 }, async () => {
      const dir = await copy();
      const server = await serve(dir, config({ url: `https://mounts.example.test${base}` }));
      try {
        let compared = 0;
        for (const name of ["tool", "other", "root"]) {
          const to = name === "root" ? "" : `${name}/`;
          for (const rel of await files(join(dir, name))) {
            const res = await get(server.port, `${base}${to}${rel}`);
            expect(res.status, `${name}/${rel}`).toBe(200);
            expect(sha(res.body), `${name}/${rel}`).toBe(sha(await readFile(join(dir, name, rel))));
            const type = TYPES[`${name}/${rel}`];
            if (type) expect(res.type, `${name}/${rel}`).toBe(type);
            compared++;
          }
        }
        expect(compared).toBe(11);
        // A folder's address is its index.html; without its "/" it forwards there, under the site's path.
        expect(sha((await get(server.port, `${base}tool/guide/`)).body)).toBe(sha(await readFile(join(dir, "tool", "guide", "index.html"))));
        const bare = await get(server.port, `${base}tool/guide`);
        expect([bare.status, bare.location]).toEqual([302, `${base}tool/guide/`]);
        // The site's own pages are still the site's.
        const home = await get(server.port, base);
        expect(home.status).toBe(200);
        expect(home.body.toString()).toContain("<h1>Mounts bench</h1>");
      } finally { await server.close(); }
    });
  });
}

describe("a mounted file read from disk on every request", () => {
  it("shows an edit in the next response, without a restart", { timeout: 60_000 }, async () => {
    const dir = await copy();
    const server = await serve(dir);
    try {
      expect((await get(server.port, "/tool/style.css")).body.toString()).toContain("sans-serif");
      await save(join(dir, "tool", "style.css"), "body { color: rebeccapurple; }\n");
      expect((await get(server.port, "/tool/style.css")).body.toString()).toBe("body { color: rebeccapurple; }\n");
    } finally { await server.close(); }
  });
});

describe("a missing folder", () => {
  it("is one warning at start, the 404 page at its route, and served once it is built", { timeout: 60_000 }, async () => {
    const dir = await copy();
    await rename(join(dir, "other"), join(dir, "other-later"));
    const warn = vi.spyOn(console, "warn");
    const server = await serve(dir);
    try {
      const said = warn.mock.calls.map(c => String(c[0])).filter(l => l.includes("site.mounts"));
      expect(said).toEqual(["[dev-server] site.mounts: ../other, published at /other/, doesn't exist: its addresses are the 404 page "
        + "until it does; build it, and the next request serves it (pd build stops without it)"]);
      const missing = await get(server.port, "/other/");
      expect(missing.status).toBe(404);
      expect(missing.body.toString()).toContain("<html");
      await mkdir(join(dir, "other"));
      await save(join(dir, "other", "index.html"), "<p>Built now.</p>\n");
      const built = await get(server.port, "/other/");
      expect([built.status, built.body.toString()]).toEqual([200, "<p>Built now.</p>\n"]);
    } finally { await server.close(); }
  });
});

describe("a file in the place of the site's own", () => {
  it("is left to the site, with one warning naming both, however often it is asked for", { timeout: 60_000 }, async () => {
    const dir = await copy();
    await save(join(dir, "root", "about", "index.html"), "<p>Not the page.</p>\n");
    await save(join(dir, "root", "notes", "feed.xml"), "<feed/>\n");
    const warn = vi.spyOn(console, "warn");
    const server = await serve(dir);
    try {
      for (let i = 0; i < 2; i++) {
        const page = await get(server.port, "/about/");
        expect(page.status).toBe(200);
        expect(page.body.toString()).toContain("<h1>About</h1>");
        const feed = await get(server.port, "/notes/feed.xml");
        expect(feed.type).toBe("application/atom+xml; charset=utf-8");
      }
      const said = warn.mock.calls.map(c => String(c[0])).filter(l => l.includes("site.mounts"));
      expect(said).toEqual([
        "[dev-server] site.mounts: ../root/about/index.html would be published at /about/index.html, which is the page /about/: "
          + "pd dev serves the site's, and pd build stops on it; remove the file from the mount, or publish the mount at another route",
        "[dev-server] site.mounts: ../root/notes/feed.xml would be published at /notes/feed.xml, which is notes/index.md's feed: "
          + "pd dev serves the site's, and pd build stops on it; remove the file from the mount, or publish the mount at another route",
      ]);
    } finally { await server.close(); }
  });

  it("two mounts with one file: the first one's, with one warning", { timeout: 60_000 }, async () => {
    const dir = await copy();
    await save(join(dir, "root", "tool", "style.css"), "/* root's */\n");
    const warn = vi.spyOn(console, "warn");
    const server = await serve(dir);
    try {
      for (let i = 0; i < 2; i++) expect((await get(server.port, "/tool/style.css")).body.toString()).toContain("sans-serif");
      expect(warn.mock.calls.map(c => String(c[0])).filter(l => l.includes("site.mounts"))).toEqual([
        "[dev-server] site.mounts: ../root/tool/style.css would be published at /tool/style.css, which clashes with ../tool/style.css: "
          + "pd dev serves the first mount's, and pd build stops on it; remove the file from one of the mounts",
      ]);
    } finally { await server.close(); }
  });
});

describe("a page's links to mounted files", () => {
  it("are no warning in pd dev", { timeout: 60_000 }, async () => {
    const dir = await copy();
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const server = await serve(dir);
    try {
      expect((await get(server.port, "/")).status).toBe(200);
      const lines = [...log.mock.calls, ...warn.mock.calls].map(c => c.map(String).join(" "));
      expect(lines.filter(l => /no page or file is built/.test(l))).toEqual([]);
    } finally { await server.close(); }
  });
});
