// On the storefront's host, every reference to a file the site serves carries ?v=<content hash> of that file as
// this host serves it: pages, the 404 page, the previews a page embeds, and url() in the CSS. The workbench's
// hosts serve the same files unstamped (only behaviour scripts carry stamps there).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { fileURLToPath } from "node:url";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
const config = validateConfig(benchConfig, "storefront-bench");
const SITE = config.storefront!.host ?? PD_HOSTS.storefront;
// Skin E's demo: a skin with web fonts in its CSS, used as a pattern package.
const skinRoot = fileURLToPath(new URL("../../../skins/experimental/demo/", import.meta.url));
let server: DevServer;
let skin: DevServer;
let skinConfig: ReturnType<typeof validateConfig>;
const skinSite = () => skinConfig.storefront!.host ?? PD_HOSTS.storefront;

beforeAll(async () => {
  server = await startDevServer(config, bench, { port: 0, live: false });
  skinConfig = validateConfig((await import("../../../skins/experimental/demo/pattern-dump.config.js")).default, "skin demo");
  skin = await startDevServer(skinConfig, skinRoot, { port: 0, live: false });
});
afterAll(async () => { await server?.close(); await skin?.close(); });

const get = (host: string, path: string) => getOn(server, host, path);
const textOn = async (s: DevServer, host: string, path: string) => (await getOn(s, host, path)).body.toString("utf8");

function getOn(s: DevServer, host: string, path: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: s.port, path, headers: { host: `${host}:${s.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}
const text = async (host: string, path: string) => (await get(host, path)).body.toString("utf8");
const sha10 = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 10);

/** Every stamped reference in `doc`: its path and stamp. */
const stamped = (doc: string) => [...doc.matchAll(/(\/(?:_pd|assets)\/[^"'()\s?#]+)\?v=([0-9a-f]+)/g)].map(m => ({ path: m[1]!, v: m[2]! }));

/** Each stamp equals the content hash of what the storefront host serves at its path. */
async function stampsHold(doc: string): Promise<void> {
  for (const { path, v } of stamped(doc)) expect(v, path).toBe(sha10((await get(SITE, path)).body));
}

describe("content stamps on the storefront host", () => {
  it("stamp every stylesheet, script and image a page links, with the hash of what is served", async () => {
    const page = await text(SITE, "/");
    expect(page).toMatch(/href="\/_pd\/base\.css\?v=[0-9a-f]{10}"/);
    expect(page).toMatch(/href="\/_pd\/components\/partials\/nav\.css\?v=[0-9a-f]{10}"/);
    expect(page).toMatch(/href="\/assets\/images\/favicon\.png\?v=[0-9a-f]{10}"/);
    expect(page).not.toMatch(/(?:href|src)="\/(?:_pd|assets)\/[^"?]+"/); // nothing served is left bare
    await stampsHold(page);
  });

  it("stamp og:image and JSON-LD image on the site's address", async () => {
    const page = await text(SITE, "/about/");
    expect(page).toMatch(/<meta property="og:image" content="https:\/\/bench\.example\.test\/assets\/images\/about\.png\?v=[0-9a-f]{10}">/);
    await stampsHold(page);
  });

  it("stamp the 404 page and the previews a page embeds", async () => {
    const notFound = await get(SITE, "/no-such-page/");
    expect(notFound.status).toBe(404);
    expect(notFound.body.toString("utf8")).toMatch(/href="\/_pd\/base\.css\?v=[0-9a-f]{10}"/);
    const preview = await text(SITE, "/preview/components/callout");
    expect(preview).toMatch(/href="\/_pd\/components\/components\/callout\.css\?v=[0-9a-f]{10}"/);
    await stampsHold(preview);
  });

  it("stamp url() in served CSS: a skin's fonts", async () => {
    const page = await textOn(skin, skinSite(), "/");
    const base = /href="(\/_pd\/base\.css\?v=[0-9a-f]{10})"/.exec(page)?.[1];
    expect(base).toBeDefined();
    const css = await textOn(skin, skinSite(), base!);
    const fonts = [...css.matchAll(/url\("?(\/assets\/skin-experimental\/fonts\/[^")]+)"?\)/g)].map(m => m[1]!);
    expect(fonts.length).toBe(7);
    for (const f of fonts) expect(f).toMatch(/\.woff2\?v=[0-9a-f]{10}$/);
    for (const { path, v } of stamped(css)) expect(v, path).toBe(sha10((await getOn(skin, skinSite(), path)).body));
    // The base sheet's own stamp covers its stamped url()s: the page's stamp is the hash of this text.
    expect(base!.split("?v=")[1]).toBe(sha10(Buffer.from(css)));
  });

  it("leave the workbench's hosts unstamped", async () => {
    expect(await text(PD_HOSTS.workbench, "/preview/components/callout")).toMatch(/href="\/_pd\/components\/components\/callout\.css"/);
  });
});
