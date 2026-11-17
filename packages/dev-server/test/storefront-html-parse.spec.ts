// A site page's rendered HTML is parsed once for the checks that read it as a tree: its classes (for its stylesheets)
// and its images used to parse the same page each (parsed-html.ts). Counted as calls of node-html-parser's parse, by
// the text parsed, while one page whose layout has an image is asked for.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { startDevServer } from "../src/index.js";
import { save } from "../../../test-support/save.js";

// How often each text was parsed.
const parses = vi.hoisted(() => new Map<string, number>());
vi.mock("node-html-parser", async (importOriginal) => {
  const real = await importOriginal<typeof import("node-html-parser")>();
  const parse = ((html: string, ...rest: unknown[]) => {
    parses.set(html, (parses.get(html) ?? 0) + 1);
    return (real.parse as (...a: unknown[]) => unknown)(html, ...rest);
  }) as typeof real.parse;
  return { ...real, parse, default: { ...real, parse } };
});

let tmp = "";
beforeAll(async () => { tmp = await realpath(await mkdtemp(join(tmpdir(), "pd-html-parse-"))); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  storefront: { pagesDir: "./pages", outDir: "./site" },
}), "site");

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host: `live.localhost:${port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("a site page's HTML", () => {
  it("is parsed once for its classes and its images", async () => {
    const root = join(tmp, "site");
    for (const [rel, text] of Object.entries({
      "src/patterns/layouts/page/page.hbs": `<main class="page"><h1>{{title}}</h1><img src="https://example.test/a.svg" alt="" width="10" height="10">{{{body}}}</main>\n`,
      "src/patterns/layouts/page/page.schema.json": `{ "type": "object", "properties": { "title": { "type": "string" }, "body": { "type": "string" } } }\n`,
      "src/styles/layouts/page.scss": `.page { margin: 0; }\n`,
      "pages/index.md": "---\ntitle: Home\n---\n\nHome.\n",
    })) await save(join(root, rel), text);
    const server = await startDevServer(config, root, { port: 0, live: false });
    try {
      parses.clear();
      const page = await get(server.port, "/");
      expect(page.status).toBe(200);
      expect(page.body).toContain(`<img src="https://example.test/a.svg"`);
    } finally {
      await server.close();
    }
    // The rendered layout (the page's markup, image included) is among what was parsed, and nothing was parsed twice.
    expect([...parses.keys()].some(html => html.includes(`<main class="page">`) && html.includes("<img"))).toBe(true);
    expect([...parses.values()].filter(n => n > 1)).toEqual([]);
  }, 60_000);
});
