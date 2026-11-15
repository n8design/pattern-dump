// Shell code is highlighted wherever a code block is written: a storefront page's markdown, a component's docs, and
// the markdown content of a component placed on a page (all three through createMarkdown, code-blocks.ts). `bash`
// and its aliases are shell script; `console` and `shell-session` are a prompt with its output. `text` stays plain.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS, PD_ROUTE_PREFIX, type ComponentDetail } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let root = "";
let server: DevServer;

const fence = (lang: string, code: string) => `\`\`\`${lang}\n${code}\n\`\`\`\n`;
const SCRIPT = `export NAME="world"\necho "hello $NAME" # greet`;
const SESSION = `$ npm run build\n> built in 2s`;
const SCRIPT_LANGS = ["bash", "sh", "shell", "zsh"];
const SESSION_LANGS = ["console", "shell-session"];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-shell-highlight-"));
  const body = [...SCRIPT_LANGS.map(l => fence(l, SCRIPT)), ...SESSION_LANGS.map(l => fence(l, SESSION)), fence("text", SCRIPT)].join("\n");
  for (const [rel, text] of Object.entries({
    "src/patterns/partials/base/base.hbs": `<main>{{> @partial-block }}</main>\n`,
    "src/patterns/layouts/page/page.hbs": `{{#> partials-base}}<h1>{{title}}</h1>\n{{{body}}}{{/partials-base}}\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "src/patterns/atoms/note/note.hbs": `<aside class="note">{{{text}}}</aside>\n`,
    "src/patterns/atoms/note/note.schema.json": JSON.stringify({ "x-pd-content": "text", properties: { text: { type: "string", contentMediaType: "text/markdown" } } }),
    "src/patterns/atoms/note/note.md": `# Note\n\n${body}`,
    "pages/index.md": `---\ntitle: Home\n---\n\n${body}`,
    "pages/placed.md": `---\ntitle: Placed\n---\n\n<pd-atoms-note>\n\n${body}\n</pd-atoms-note>\n`,
  })) await save(join(root, rel), text);
  const config = validateConfig(defineConfig({ outDir: "./.out/wb", storefront: { pagesDir: "./pages", outDir: "./.out/site" } }), "test");
  server = await startDevServer(config, root, { port: 0, live: false });
});
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

function get(path: string, host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${host}:${server.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Each code block's <pre>, in order: highlighted ones carry Shiki's spans, plain ones are shiki-plain. */
const blocks = (html: string): string[] => html.match(/<pre class="shiki[^"]*"[\s\S]*?<\/pre>/g) ?? [];
const highlighted = (pre: string) => !pre.includes("shiki-plain") && /<span class="__shiki_/.test(pre);

describe.each([
  ["a storefront page's markdown", () => get("/", PD_HOSTS.storefront)],
  ["a component's docs", async () => (JSON.parse(await get(`${PD_ROUTE_PREFIX.component}atoms/note`, PD_HOSTS.workbench)) as ComponentDetail).doc ?? ""],
  ["a placed component's markdown content", () => get("/placed/", PD_HOSTS.storefront)],
])("shell code in %s", (_where, load) => {
  it("is highlighted for bash, sh, shell, zsh, console and shell-session; text stays plain", async () => {
    const pres = blocks(await load());
    expect(pres).toHaveLength(SCRIPT_LANGS.length + SESSION_LANGS.length + 1);
    for (const pre of pres.slice(0, -1)) expect(highlighted(pre), pre).toBe(true);
    expect(pres.at(-1)).toContain("shiki-plain");
    for (const pre of pres) expect(pre).toMatch(/tabindex="0"/);
  });
});
