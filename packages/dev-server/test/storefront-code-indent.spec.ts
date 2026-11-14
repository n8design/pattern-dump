// A code block on a storefront page keeps its lines as written, though the skin's base partial includes the page's
// content on an indented line (`    {{> @partial-block }}`, as the starter writes it): Handlebars would indent every
// line after the first by those spaces, inside the <pre> too.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let root = "";
let server: DevServer;

const CODE = "function hello() {\n  if (ok) {\n    return 1;\n  }\n}";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-code-indent-"));
  for (const [rel, text] of Object.entries({
    "src/patterns/partials/base/base.hbs": `<div class="site">\n  <main id="main">\n    {{> @partial-block }}\n  </main>\n</div>\n`,
    "src/patterns/layouts/page/page.hbs": `{{#> partials-base}}<h1>{{title}}</h1>\n{{{body}}}{{/partials-base}}\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "pages/index.md": `---\ntitle: Home\n---\n\n\`\`\`text\n${CODE}\n\`\`\`\n`,
  })) await save(join(root, rel), text);
  const config = validateConfig(defineConfig({ outDir: "./.out/wb", storefront: { pagesDir: "./pages", outDir: "./.out/site" } }), "test");
  server = await startDevServer(config, root, { port: 0, live: false });
});
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

function page(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${PD_HOSTS.storefront}:${server.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.end();
  });
}
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

describe("a code block through an indented {{> @partial-block }}", () => {
  it("keeps every line's own indentation", async () => {
    const html = await page("/");
    const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html);
    expect(pre, html).not.toBeNull();
    expect(text(pre![1]!).replace(/\n$/, "")).toBe(CODE);
  });
});
