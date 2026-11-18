// Symbol sets on a storefront page (`requireAssets` in a component's .md): the sets that the page's layout and the
// components it places need, as their previews load them, once each, hidden by size right after the image sprite,
// outside the search index. A set no asset folder has fails the page, naming the component; so does an id two sets
// declare, or one a symbol image has. A heading never takes a set's id.
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
import { FLOW } from "./symbol-fixtures.js";

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: ["./src/assets", "./pkg/assets"] },
  storefront: { pagesDir: "./pages", outDir: "./site" },
});
const SITE = config.storefront!.host ?? PD_HOSTS.storefront;
const json = (v: unknown) => JSON.stringify(v);
const set = (...ids: string[]) => `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:none">`
  + ids.map(id => `<symbol id="${id}" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></symbol>`).join("") + `</svg>\n`;
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
const page = (layout: string, body: string) => `---\ntitle: T\nlayout: ${layout}\n---\n\n${body}\n`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-icon-sets-"));
  const schema = json({ type: "object", required: ["title"], properties: { title: { type: "string" } } });
  for (const [rel, body] of Object.entries({
    // A layout that includes an icon (its set: "icons"), and one that includes nothing that needs a set.
    "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{> atoms-icon }}{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": schema,
    "src/patterns/layouts/plain/plain.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
    "src/patterns/layouts/plain/plain.schema.json": schema,
    "src/patterns/atoms/icon/icon.hbs": `<svg class="icon" aria-hidden="true"><use href="#icon-check"/></svg>\n`,
    "src/patterns/atoms/icon/icon.md": `---\nrequireAssets: [icons]\n---\n`,
    // A component placed with a pd- tag, whose set comes from a package's asset folder only.
    "src/patterns/atoms/badge/badge.hbs": `<span class="badge"><svg aria-hidden="true"><use href="#pkg-star"/></svg>{{label}}</span>\n`,
    "src/patterns/atoms/badge/badge.md": `---\nrequireAssets: [pkg-icons, icons]\n---\n`,
    "src/patterns/atoms/badge/badge.schema.json": json({ type: "object", required: ["label"], properties: { label: { type: "string" } } }),
    "src/patterns/atoms/gone/gone.hbs": `<span>gone</span>\n`,
    "src/patterns/atoms/gone/gone.md": `---\nrequireAssets: [nowhere]\n---\n`,
    "src/patterns/atoms/gone/gone.schema.json": json({ type: "object", properties: {} }),
    "src/patterns/atoms/twin/twin.hbs": `<span>twin</span>\n`,
    "src/patterns/atoms/twin/twin.md": `---\nrequireAssets: [twin]\n---\n`,
    "src/patterns/atoms/twin/twin.schema.json": json({ type: "object", properties: {} }),
    "src/patterns/atoms/imgish/imgish.hbs": `<span>imgish</span>\n`,
    "src/patterns/atoms/imgish/imgish.md": `---\nrequireAssets: [imgish]\n---\n`,
    "src/patterns/atoms/imgish/imgish.schema.json": json({ type: "object", properties: {} }),
    "src/assets/images/icons.svg": set("icon-check"),
    "src/assets/images/twin.svg": set("icon-check"),
    "src/assets/images/imgish.svg": set("img-flow"),
    "src/assets/symbols/flow.svg": FLOW,
    "pkg/assets/pkg-icons.svg": set("pkg-star"),
    "pages/index.md": page("page", `<pd-atoms-badge label="New"></pd-atoms-badge>\n\n![A flow](#flow)`),
    "pages/plain.md": page("plain", "No icons here."),
    "pages/heading.md": page("page", "## Icon check"),
    "pages/missing.md": page("plain", `<pd-atoms-gone></pd-atoms-gone>`),
    "pages/twins.md": page("page", `<pd-atoms-twin></pd-atoms-twin>`),
    "pages/imgish.md": page("plain", `<pd-atoms-imgish></pd-atoms-imgish>\n\n![A flow](#flow)`),
  })) await save(join(root, rel), body);
  server = await startDevServer(config, root, {
    port: 0, live: false, onSearchRecord: r => { records.set(r.route, r); }, onStorefrontNote: n => { notes.push(n); },
  });
});
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("symbol sets on a storefront page", () => {
  it("the layout's and the placed components' sets, once each, in the order first needed, after the image sprite", async () => {
    const r = await get("/");
    expect(r.status, r.body).toBe(200);
    const body = bodyOf(r.body);
    const sprites = [...body.matchAll(/<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"[^>]*>/g)].map(m => m.index);
    expect(sprites).toHaveLength(3);
    // The image sprite first, then the layout's set (icons), then the badge's own (pkg-icons, from the package).
    expect(body.indexOf(`<symbol id="img-flow"`)).toBeLessThan(body.indexOf(`<symbol id="icon-check"`));
    expect(body.indexOf(`<symbol id="icon-check"`)).toBeLessThan(body.indexOf(`<symbol id="pkg-star"`));
    expect([...body.matchAll(/<symbol id="icon-check"/g)]).toHaveLength(1);
    // Hidden by size: the file's own width, height and display:none are gone, and so is its XML declaration.
    expect(body).toContain(`<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><symbol id="icon-check"`);
    expect(body).not.toMatch(/display:none|<\?xml/);
  });

  it("a page whose components need none has none; the search index never gets them", async () => {
    expect(bodyOf((await get("/plain/")).body)).not.toContain("<symbol");
    expect(records.get("/")?.body).not.toContain("<symbol");
  });

  it("a heading whose anchor a set's symbol has gets the next one, with a note", async () => {
    const r = await get("/heading/");
    expect(r.status).toBe(200);
    expect(r.body).toContain(`<h2 id="icon-check-1">Icon check</h2>`);
    expect(notes).toContain(`heading.md: heading "Icon check" is #icon-check-1, because the symbol set "icons" on the page uses id="icon-check"`);
  });

  it("a set no asset folder has fails the page, naming the component and the set", async () => {
    const r = await get("/missing/");
    expect(r.status).toBe(500);
    expect(r.body).toContain(`missing.md: atoms/gone needs the symbol set "nowhere" (requireAssets), and no asset folder has nowhere.svg or images/nowhere.svg`);
  });

  it("an id two sets declare, or one a symbol image has, fails the page", async () => {
    const twins = await get("/twins/");
    expect(twins.status).toBe(500);
    expect(twins.body).toContain(`twins.md: the symbol sets "icons" and "twin" both declare id="icon-check": a &lt;use&gt; of it could draw either`);
    const imgish = await get("/imgish/");
    expect(imgish.status).toBe(500);
    expect(imgish.body).toContain(`imgish.md: the symbol set "imgish" declares id="img-flow", which a symbol image on the page has`);
  });
});
