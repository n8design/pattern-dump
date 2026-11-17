// A site page's checks read the design system's templates, schemas and sample data through one store per discovery
// (design-files.ts): once the first page has read them, more pages read none of them again. Counted on the dev-server's
// own reads (the renderer has its own store), with every page of a small site asked for in turn.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { startDevServer } from "../src/index.js";
import { save } from "../../../test-support/save.js";

// How often each file was read, by path.
const reads = vi.hoisted(() => new Map<string, number>());
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = ((path: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
    reads.set(String(path), (reads.get(String(path)) ?? 0) + 1);
    return (fs.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
  }) as typeof fs.readFile;
  return { ...fs, readFile, default: { ...fs, readFile } };
});

let tmp = "";
// By its real path: files are read by theirs (macOS gives /var for /private/var).
beforeAll(async () => { tmp = await realpath(await mkdtemp(join(tmpdir(), "pd-design-files-"))); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  storefront: { pagesDir: "./pages", outDir: "./site" },
}), "site");

function get(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host: `live.localhost:${port}` } }, res => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the design system's files, read for site pages", () => {
  it("are not read again for every page", async () => {
    const root = join(tmp, "site");
    const files: Record<string, string> = {
      "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}{{> atoms-card}}</main>\n`,
      "src/patterns/layouts/page/page.schema.json": `{ "type": "object", "properties": { "title": { "type": "string" }, "body": { "type": "string" } } }\n`,
      "src/patterns/layouts/page/page.json": `{ "title": "layout-sample" }\n`,
      "src/patterns/atoms/card/card.hbs": `<p class="card">card</p>\n`,
      "src/patterns/atoms/card/card.schema.json": `{ "type": "object", "properties": { "title": { "type": "string" } } }\n`,
      "src/patterns/atoms/card/card.json": `{ "title": "card-sample" }\n`,
      "src/styles/atoms/card.scss": `.card { color: red; }\n`,
      "pages/index.md": "---\ntitle: Home\n---\n\nHome.\n",
    };
    for (let i = 0; i < 6; i++) files[`pages/p${i}.md`] = `---\ntitle: Page ${i}\n---\n\nPage ${i}.\n`;
    for (const [rel, text] of Object.entries(files)) await save(join(root, rel), text);

    const server = await startDevServer(config, root, { port: 0, live: false });
    const patterns = join(root, "src", "patterns") + sep;
    /** The design system's files read so far, with how often. */
    const design = (): Record<string, number> => Object.fromEntries([...reads]
      .filter(([path]) => path.startsWith(patterns) && /\.(hbs|json)$/.test(path)).map(([path, count]) => [path.slice(patterns.length), count]));
    let afterFirst: Record<string, number>;
    try {
      expect(await get(server.port, "/")).toBe(200);
      afterFirst = design();
      for (let i = 0; i < 6; i++) expect(await get(server.port, `/p${i}/`)).toBe(200);
    } finally {
      await server.close();
    }
    // The first page read the layout's files and the card's; six more pages read none of them again.
    expect(Object.keys(afterFirst)).toEqual(expect.arrayContaining([
      "atoms/card/card.hbs", "atoms/card/card.schema.json", "layouts/page/page.hbs", "layouts/page/page.json", "layouts/page/page.schema.json",
    ]));
    expect(design()).toEqual(afterFirst);
  }, 60_000);
});
