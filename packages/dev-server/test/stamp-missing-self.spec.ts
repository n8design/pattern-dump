// A page whose head links a file that doesn't exist (a favicon not there yet): stamping looks the file up, gets the
// 404 page, and the 404 page links the same file. The lookup must end there, not wait on itself. Found on the htwoo
// rehearsal (FEAT-SITE-MOUNTS, acceptance 8): every page and the 404 page hung, in pd dev and pd build.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { startDevServer } from "../src/index.js";
import { buildStaticSite } from "../src/static-build.js";
import { save } from "../../../test-support/save.js";

let root = "";
const FILES: Record<string, string> = {
  "pages/index.md": "---\ntitle: Home\n---\n\nText.\n",
  "pages/about.md": "---\ntitle: About\n---\n\nText.\n",
  "src/patterns/partials/head/head.hbs": `<link rel="icon" href="/favicon-32x32.png">\n`,
  "src/patterns/layouts/page/page.hbs": "<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>\n",
  "src/patterns/layouts/page/page.schema.json": JSON.stringify({ properties: { title: { type: "string" } } }),
  "src/styles/x.scss": "",
};
const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" },
  site: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/" },
} as never), "test");

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-stamp-self-"));
  for (const [rel, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const get = (port: number, path: string) => new Promise<number>((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, path, headers: { host: `live.localhost:${port}` } }, res => {
    res.resume();
    res.on("end", () => resolve(res.statusCode ?? 0));
  });
  req.setTimeout(8_000, () => req.destroy(new Error(`${path}: no answer in 8 s`)));
  req.on("error", reject).end();
});

describe("a page that links a missing file", () => {
  it("pd dev answers the page, the 404 page and the missing file", { timeout: 60_000 }, async () => {
    const server = await startDevServer(config, root, { port: 0, wsPort: 0, live: true });
    try {
      expect(await get(server.port, "/about/")).toBe(200);
      expect(await get(server.port, "/404.html")).toBe(404);
      expect(await get(server.port, "/favicon-32x32.png")).toBe(404);
      expect(await get(server.port, "/nowhere/")).toBe(404);
    } finally { await server.close(); }
  });

  it("pd build ends, naming the missing file", { timeout: 60_000 }, async () => {
    // The crawl asks for the file (it is shaped like an image beside the pages) and stops on its 404.
    await expect(buildStaticSite(config, root, { outDir: join(root, "dist") })).rejects.toThrow("  - /favicon-32x32.png: 404");
  });
});
