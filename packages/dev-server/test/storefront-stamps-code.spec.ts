// The storefront host's stamping pass stamps references, never text: code on a page that quotes an <img src> or a
// <link href> to a file the site serves is shown exactly as written, in inline code, a highlighted fence, a plain
// fence and an indented block alike. The files exist, so a real reference to them would be stamped.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "node-html-parser";
import { defineConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  storefront: { pagesDir: "./pages", outDir: "./site" },
});
const SITE = config.storefront!.host ?? PD_HOSTS.storefront;
const IMG = `<img src="/assets/images/logo.svg" width="10" height="10" alt="Logo">`;
const LINK = `<link rel="stylesheet" href="/assets/site.css">`;
let root = "";
let server: DevServer;

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

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-stamps-code-"));
  for (const [rel, body] of Object.entries({
    "src/assets/images/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`,
    "src/assets/site.css": `body { margin: 0; }\n`,
    "src/patterns/layouts/page/page.hbs": `<main>${IMG}{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "pages/index.md": [
      "---", "title: Code", "---", "",
      `Inline: \`${IMG}\` and \`${LINK}\`.`, "",
      "```html", IMG, LINK, "```", "",
      "```", IMG, LINK, "```", "",
      `    ${IMG}`, `    ${LINK}`, "",
    ].join("\n"),
  })) await save(join(root, rel), body);
  server = await startDevServer(config, root, { port: 0, live: false });
});
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("the stamping pass and code on a page", () => {
  it("stamps the layout's real <img>, and shows every code example exactly as written", async () => {
    const page = await get("/");
    expect(page.status).toBe(200);
    const doc = parse(page.body);
    // The real element is stamped: the files exist, so a reference to them is.
    expect(doc.querySelector("main > img")!.getAttribute("src")).toMatch(/^\/assets\/images\/logo\.svg\?v=[0-9a-f]{10}$/);
    // Every code example reads as the markdown wrote it: each <code>'s text, its highlighting spans taken out and its
    // characters decoded. (Read with a pattern, not the parser: a copy button's data-raw holds a raw "<" and ">",
    // which is valid HTML that node-html-parser does not read.)
    const decode = (t: string) => t.replace(/<[^>]+>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&#x3C;", "<")
      .replaceAll("&quot;", `"`).replaceAll("&#39;", "'").replaceAll("&amp;", "&");
    const shown = [...page.body.matchAll(/<code>([\s\S]*?)<\/code>/g)].map(m => decode(m[1]!).trim());
    expect(shown).toEqual([IMG, LINK, `${IMG}\n${LINK}`, `${IMG}\n${LINK}`, `${IMG}\n${LINK}`]);
  });
});
