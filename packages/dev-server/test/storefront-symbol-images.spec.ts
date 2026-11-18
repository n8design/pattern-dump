// Symbol images on a storefront page, through the server pd build crawls: the page's hidden sprite at the top of its
// body with the symbols it draws, once each; never the search index's; and a heading never takes a symbol's id.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import type { SearchRecord } from "../src/storefront/search.js";
import { save } from "../../../test-support/save.js";
import { FLOW, LAYERS } from "./symbol-fixtures.js";

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  storefront: { pagesDir: "./pages", outDir: "./site" },
});
const SITE = config.storefront!.host ?? PD_HOSTS.storefront;
let root = "";
let server: DevServer;
const records = new Map<string, SearchRecord>();
const notes: string[] = [];

function get(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${SITE}:${server.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}
const bodyOf = (html: string): string => html.slice(html.indexOf("<body"), html.indexOf("</body>"));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-symbol-images-"));
  for (const [rel, body] of Object.entries({
    "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "src/assets/symbols/flow.svg": FLOW,
    "src/assets/symbols/layers.svg": LAYERS,
    "pages/index.md": `---\ntitle: Home\n---\n\n![Layers](#layers "Captioned")\n\n![A flow](#flow) and ![The flow again](#flow)\n`,
    "pages/plain.md": `---\ntitle: Plain\n---\n\nNo symbols here.\n`,
    "pages/clash.md": `---\ntitle: Clash\n---\n\n## Img flow\n\n![A flow](#flow)\n`,
  })) await save(join(root, rel), body);
  server = await startDevServer(config, root, {
    port: 0, live: false, onSearchRecord: r => { records.set(r.route, r); }, onStorefrontNote: n => { notes.push(n); },
  });
});
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("symbol images on the storefront", () => {
  it("the sprite opens the body: each symbol the page draws, once, in the order first drawn", async () => {
    const page = await get("/");
    expect(page.status).toBe(200);
    const body = bodyOf(page.body);
    expect(body.startsWith(`<body>\n<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n<symbol id="img-layers" viewBox="0 0 400 200">`)).toBe(true);
    expect([...body.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1])).toEqual(["img-layers", "img-flow"]);
    expect([...body.matchAll(/<use href="#img-flow"\/>/g)]).toHaveLength(2);
    expect(body).toContain(`<figcaption>Captioned</figcaption>`);
  });

  it("a page that draws none has no sprite; the search index never gets the sprite", async () => {
    expect(bodyOf((await get("/plain/")).body)).not.toContain("<symbol");
    expect(records.get("/")?.body).toContain(`<use href="#img-flow"/>`);
    expect(records.get("/")?.body).not.toContain("<symbol");
  });

  it("a heading whose anchor a symbol has as its id gets the next one, with a note", async () => {
    const page = await get("/clash/");
    expect(page.status).toBe(200);
    expect(page.body).toContain(`<h2 id="img-flow-1">Img flow</h2>`);
    expect(page.body).toContain(`<symbol id="img-flow" `);
    expect(notes).toContain(`clash.md: heading "Img flow" is #img-flow-1, because a symbol image on the page uses id="img-flow"`);
  });
});
