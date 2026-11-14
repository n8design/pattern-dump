// A site published under a path (storefront.url "https://bench.example.test/sub/") is served under it: the host's
// root forwards there, every root-relative reference a page or stylesheet makes is under it, stamps are those of the
// same files at the root, an address outside the path is the 404 page, and there is no robots.txt. The workbench's
// hosts are unchanged.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
const rootConfig = validateConfig(benchConfig, "storefront-bench");
const subConfig = validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, url: "https://bench.example.test/sub" } }, "storefront-bench");
const SITE = rootConfig.storefront!.host ?? PD_HOSTS.storefront;
let root: DevServer;
let sub: DevServer;
let live: DevServer;

beforeAll(async () => {
  [root, sub, live] = await Promise.all([
    startDevServer(rootConfig, bench, { port: 0, live: false }),
    startDevServer(subConfig, bench, { port: 0, live: false }),
    startDevServer(subConfig, bench, { port: 0, wsPort: 0, live: true }),
  ]);
});
afterAll(async () => { await Promise.all([root?.close(), sub?.close(), live?.close()]); });

interface Got { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer; text: string }
function get(s: DevServer, path: string, host = SITE): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: s.port, path, headers: { host: `${host}:${s.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text: body.toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end();
  });
}
const sha10 = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 10);

/** Every root-relative URL in a document's href, src and srcset attributes. */
const rootRelative = (html: string): string[] => [
  ...[...html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)].map(m => m[1]!),
  ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap(m => m[1]!.split(",").map(c => c.trim().split(/\s+/)[0]!)),
].filter(u => !u.startsWith("//"));

describe("a storefront under a path", () => {
  it("forwards the host's root, and the path without its slash, to the path", async () => {
    for (const path of ["/", "/sub"]) {
      const res = await get(sub, path);
      expect(res.status, path).toBe(302);
      expect(res.headers.location, path).toBe("/sub/");
    }
    expect((await get(sub, "/?q=1")).headers.location).toBe("/sub/?q=1");
  });

  it("serves its pages under the path, every root-relative reference under it", async () => {
    for (const page of ["/sub/", "/sub/about/", "/sub/guides/setup/", "/sub/articles/"]) {
      const res = await get(sub, page);
      expect(res.status, page).toBe(200);
      const refs = rootRelative(res.text);
      expect(refs.length, page).toBeGreaterThan(3);
      for (const ref of refs) expect(ref, `${page}: ${ref}`).toMatch(/^\/sub\//);
    }
  });

  it("serves what the pages reference: stylesheets, scripts, images and previews", async () => {
    const pages = await Promise.all(["/sub/", "/sub/articles/", "/sub/guides/setup/"].map(p => get(sub, p)));
    const refs = new Set(pages.flatMap(p => rootRelative(p.text)).filter(u => /^\/sub\/(?:_pd|assets|preview)\//.test(u)));
    expect([...refs].some(u => u.startsWith("/sub/_pd/images/"))).toBe(true);
    expect([...refs].some(u => u.startsWith("/sub/preview/"))).toBe(true);
    for (const ref of refs) expect((await get(sub, ref)).status, ref).toBe(200);
  });

  it("stamps the same as at the root: the hash of the file as served under the path", async () => {
    const at = (await get(root, "/")).text;
    const under = (await get(sub, "/sub/")).text;
    const stamps = (doc: string, prefix: string) => [...doc.matchAll(/="(\/[^"?]+)\?v=([0-9a-f]{10})"/g)]
      .map(m => `${m[1]!.slice(prefix.length - 1)}?v=${m[2]}`).sort();
    expect(stamps(under, "/sub/")).toEqual(stamps(at, "/"));
    for (const m of under.matchAll(/="(\/sub\/_pd\/[^"?]+)\?v=([0-9a-f]{10})"/g)) {
      expect(m[2], m[1]).toBe(sha10((await get(sub, m[1]!)).body));
    }
  });

  it("puts root-relative url()s in its CSS under the path", async () => {
    const page = (await get(sub, "/sub/")).text;
    const sheets = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]!);
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      const css = (await get(sub, sheet)).text;
      for (const m of css.matchAll(/url\(\s*['"]?(\/[^'")\s]*)/g)) expect(m[1], sheet).toMatch(/^\/sub\/|^\/\//);
    }
  });

  it("carries the path in canonical, og:url, og:image (stamped) and JSON-LD", async () => {
    const page = (await get(sub, "/sub/about/")).text;
    expect(page).toContain(`<link rel="canonical" href="https://bench.example.test/sub/about/">`);
    expect(page).toContain(`<meta property="og:url" content="https://bench.example.test/sub/about/">`);
    const og = /<meta property="og:image" content="https:\/\/bench\.example\.test(\/sub\/assets\/[^"?]+)\?v=([0-9a-f]{10})">/.exec(page);
    expect(og, page.match(/<meta property="og:image"[^>]*>/)?.[0]).not.toBeNull();
    expect(og![2]).toBe(sha10((await get(sub, og![1]!)).body));
    expect(page).toContain(`"url":"https://bench.example.test/sub/about/"`);
  });

  it("forwards an old route under the path", async () => {
    const stub = await get(sub, "/sub/setup/");
    expect(stub.status).toBe(200);
    expect(stub.text).toContain(`<meta http-equiv="refresh" content="0; url=/sub/guides/setup/">`);
    expect(stub.text).toContain(`<a href="/sub/guides/setup/">`);
    expect(stub.text).toContain(`<link rel="canonical" href="https://bench.example.test/sub/guides/setup/">`);
  });

  it("answers an address outside the path with the site's 404 page", async () => {
    const res = await get(sub, "/guides/setup/");
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/<link rel="stylesheet" href="\/sub\/_pd\//);
    expect((await get(sub, "/sub/no-such-page/")).status).toBe(404);
  });

  it("has a sitemap under the path, and no robots.txt", async () => {
    const sitemap = await get(sub, "/sub/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.text).toContain("<loc>https://bench.example.test/sub/about/</loc>");
    expect(sitemap.text).not.toMatch(/<loc>https:\/\/bench\.example\.test\/(?!sub\/)/);
    expect((await get(sub, "/sub/robots.txt")).status).toBe(404);
    expect((await get(root, "/robots.txt")).status).toBe(200);
  });

  it("in pd dev, carries the address the browser is on, under the path", async () => {
    const page = (await get(live, "/sub/about/")).text;
    expect(page).toContain(`<link rel="canonical" href="http://${SITE}:${live.port}/sub/about/">`);
  });

  it("leaves the workbench's hosts as they were", async () => {
    const shell = await get(sub, "/", PD_HOSTS.workbench);
    expect(shell.status).toBe(200);
    expect(shell.text).toContain(`href="/_pd/main.css"`);
  });
});
