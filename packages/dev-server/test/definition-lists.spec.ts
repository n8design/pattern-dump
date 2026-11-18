// Definition lists (markdown-it-deflist, installed in createMarkdown): `term` then `: definition` renders as plain
// <dl>/<dt>/<dd> in every markdown Pattern Dump renders, the workbench's docs, a site page's body and a placed
// component's markdown content, with raw HTML escaped and links checked as everywhere else. A component placed with a
// pd- tag inside a definition is placed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { renderDoc } from "../src/markdown.js";
import { save } from "../../../test-support/save.js";

const TIGHT = "outDir\n: A string. The only required top-level key.\n: The folder `pd build` writes the workbench to.\n\n"
  + "patternsDir\n: A string. Default `<sourceDir>/patterns`.\n";
const TIGHT_HTML = `<dl>\n<dt>outDir</dt>\n<dd>A string. The only required top-level key.</dd>\n`
  + `<dd>The folder <code>pd build</code> writes the workbench to.</dd>\n<dt>patternsDir</dt>\n`
  + `<dd>A string. Default <code>&lt;sourceDir&gt;/patterns</code>.</dd>\n</dl>\n`;
const LOOSE = "outDir\n\n: A string.\n\n: The folder.\n";
const LOOSE_HTML = `<dl>\n<dt>outDir</dt>\n<dd>\n<p>A string.</p>\n</dd>\n<dd>\n<p>The folder.</p>\n</dd>\n</dl>\n`;
const docs = (body: string) => renderDoc(body, async () => "", new Map());
const site = (body: string) => renderDoc(body, async () => "", new Map(), { embed: "frame", workbenchUrl: "/wb/", problems: [] });

describe("definition lists in markdown", () => {
  it("a tight list: each definition's text straight in its <dd>, in the docs and on a page alike", async () => {
    expect(await docs(TIGHT)).toBe(TIGHT_HTML);
    expect(await site(TIGHT)).toBe(TIGHT_HTML);
  });

  it("a loose list: each definition in a paragraph; ~ works as : does", async () => {
    expect(await docs(LOOSE)).toBe(LOOSE_HTML);
    expect(await docs("outDir\n~ A string.\n")).toBe(`<dl>\n<dt>outDir</dt>\n<dd>A string.</dd>\n</dl>\n`);
  });

  it("escapes raw HTML in a term and a definition, and refuses a javascript: link in either", async () => {
    const html = await docs("<b>key</b> [t](javascript:alert(1))\n: <img src=x onerror=alert(1)> [d](javascript:alert(2))\n");
    expect(html).toBe(`<dl>\n<dt>&lt;b&gt;key&lt;/b&gt; [t](javascript:alert(1))</dt>\n`
      + `<dd>&lt;img src=x onerror=alert(1)&gt; [d](javascript:alert(2))</dd>\n</dl>\n`);
    expect(html).not.toContain("<a ");
  });

  it("a term is no heading: it gets no anchor on a page", async () => {
    expect(await site("## Keys\n\noutDir\n: A string.\n")).toBe(`<h2 id="keys">Keys</h2>\n<dl>\n<dt>outDir</dt>\n<dd>A string.</dd>\n</dl>\n`);
  });
});

describe("definition lists on a site page", () => {
  const config = defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" }, storefront: { pagesDir: "./pages", outDir: "./site" },
  });
  const SITE = config.storefront!.host ?? PD_HOSTS.storefront;
  let root = "";
  let server: DevServer;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pd-deflist-"));
    for (const [rel, body] of Object.entries({
      "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
      "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
      "src/patterns/atoms/note/note.hbs": `<aside>{{{body}}}</aside>\n`,
      "src/patterns/atoms/note/note.schema.json": JSON.stringify({ type: "object", "x-pd-content": "body",
        properties: { body: { type: "string", contentMediaType: "text/markdown" } } }),
      "pages/index.md": `---\ntitle: Home\n---\n\nTerm\n: <pd-atoms-note>\n  outDir\n  : A string.\n  </pd-atoms-note>\n`,
    })) await save(join(root, rel), body);
    server = await startDevServer(config, root, { port: 0, live: false });
  });
  afterAll(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("places a component inside a definition, and its markdown content renders the same list", async () => {
    const body = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: server.port, path: "/", headers: { host: `${SITE}:${server.port}` } }, res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end();
    });
    expect(body.status, body.text).toBe(200);
    // The placed component is a block of its own inside the definition.
    expect(body.text).toContain(`<main><h1>Home</h1><dl>\n<dt>Term</dt>\n<dd>\n<aside><dl>\n<dt>outDir</dt>\n<dd>A string.</dd>\n</dl>\n</aside>\n\n</dd>\n</dl>\n</main>`);
  });
});
