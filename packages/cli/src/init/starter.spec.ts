// The shipped starter, held to the bar a new project deserves: it scaffolds, boots, renders every
// component without a diagnostic, and audits with ZERO defects. The teaching set shows how Pattern
// Dump works — not what it catches.
//
// Scaffolded INSIDE this package (not the OS tmpdir) so the generated config's import resolves:
// the config is bundled by esbuild from its own location, and here it imports the in-repo
// @pattern-dump/config instead of the not-yet-installed distributable.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { request } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { crc32, deflateSync } from "node:zlib";
import type { ComponentDetailResponse, ComponentTree, TreeNode } from "@pattern-dump/contracts";
import { loadConfig } from "@pattern-dump/core";
import { runDiagnosticsAudit, startDevServer } from "@pattern-dump/dev-server";
import { applyPlan, readTemplates } from "./files.js";
import { planInit } from "./plan.js";
import { save } from "../../../../test-support/save.js";

const cliDir = fileURLToPath(new URL("../../", import.meta.url));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
let dir = "";
let bareDir = "";
let siteDir = "";

async function scaffold(examples: boolean, storefront = false): Promise<string> {
  const target = await mkdtemp(join(cliDir, ".test-scaffold-"));
  const templates = await readTemplates(join(cliDir, "templates"));
  const r = planInit(
    templates,
    { name: "starter-check", brand: "Starter Check", examples, storefront, dependency: "^0.0.0" },
    { packageJson: null, exists: () => false },
    "@pattern-dump/config",
  );
  if (!r.ok) throw new Error(r.reason);
  await applyPlan(target, r.plan);
  return target;
}

/** `tsc --noEmit` against the scaffold's own tsconfig — what `npm run typecheck` runs. */
const typecheck = (project: string) =>
  promisify(execFile)(process.execPath, [tsc, "--noEmit", "-p", project]).then(
    () => ({ code: 0, output: "" }),
    (e: { code?: number; stdout?: string }) => ({ code: e.code ?? 1, output: e.stdout ?? "" }),
  );

beforeAll(async () => {
  dir = await scaffold(true);
  bareDir = await scaffold(false);
  siteDir = await scaffold(false, true);
}, 60_000);

afterAll(async () => {
  for (const d of [dir, bareDir, siteDir]) if (d) await rm(d, { recursive: true, force: true });
});

/** A GET on a named host of the server (fetch ignores an overridden Host header). */
/** A PNG of one flat colour, made here: the starter ships no image, so its spec makes the one it needs. */
function flatPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    typed.copy(out, 4);
    out.writeUInt32BE(crc32(typed), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

const onHost = (port: number, host: string, path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  request({ host: "127.0.0.1", port, path, headers: { host: `${host}:${port}` } }, res => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", d => { body += d; });
    res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
  }).on("error", reject).end();
});

const components = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap(n => [...(n.kind === "component" ? [n] : []), ...components(n.children ?? [])]);

describe("the starter project", () => {
  it("brands the shell with the chosen title", async () => {
    expect(await readFile(join(dir, "pattern-dump.config.ts"), "utf8")).toContain('title: "Starter Check"');
  });

  it("audits with zero static defects, and every component renders", async () => {
    const config = await loadConfig(dir);
    const { graph } = await runDiagnosticsAudit(config, dir);
    expect(graph.occurrences).toEqual([]);
    expect(graph.components.map(c => [c.id, c.render])).toEqual(
      graph.components.map(c => [c.id, "ok"]),
    );
    expect(graph.components.map(c => c.id).sort()).toEqual([
      "atoms/button", "molecules/search-field", "molecules/search-field/input", "pages/example",
    ]);
  }, 120_000);

  it("boots, shows the teaching set in order, and every component and variant is diagnostic-free", async () => {
    const config = await loadConfig(dir);
    const server = await startDevServer(config, dir, { port: 0, wsPort: 0 });
    try {
      const get = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);
      const tree = await (await get("/api/tree")).json() as ComponentTree;
      expect(tree.roots.map(r => [r.path, r.title, r.hasOverview])).toEqual([
        ["atoms", "Atoms", true], ["molecules", "Molecules", true], ["pages", "Pages", true],
      ]);
      expect(components(tree.roots).find(c => c.path === "molecules/search-field/input")?.visibility).toBe("private");

      for (const [id, variant] of [
        ["atoms/button"], ["atoms/button", "secondary"], ["atoms/button", "icon"],
        ["molecules/search-field"], ["molecules/search-field/input"], ["pages/example"],
      ] as Array<[string, string?]>) {
        const d = await (await get(`/api/component/${id}${variant ? `?variant=${variant}` : ""}`)).json() as ComponentDetailResponse;
        expect(d.diagnostics, `${id}${variant ? `~${variant}` : ""}`).toEqual([]);
      }

      const search = await (await get("/api/component/molecules/search-field")).json() as ComponentDetailResponse;
      expect(search.relationships.uses.sort()).toEqual(["atoms/button", "molecules/search-field/input"]);

      // Behaviour: the search field's script is required by the component, reaches every preview that
      // shows one (the example page includes it), and compiles.
      for (const id of ["molecules/search-field", "pages/example"]) {
        const d = await (await get(`/api/component/${id}`)).json() as ComponentDetailResponse;
        expect(d.document, id).toMatch(/<script type="module" src="\/_pd\/scripts\/search-field\.js[?"]/);
      }
      const script = await get("/_pd/scripts/search-field.js");
      expect(script.status).toBe(200);
      expect(script.headers.get("content-type")).toContain("javascript");
      const js = await script.text();
      expect(js).toContain("form.search-field");
      expect(js).not.toContain("HTMLFormElement>"); // types stripped

      const themes = await (await get("/api/themes")).json() as Array<{ name: string; tokens?: Record<string, string | null> }>;
      expect(themes.map(t => t.name).sort()).toEqual(["dark", "light"]);
      for (const t of themes) expect(Object.values(t.tokens ?? {}).every(v => v !== null), t.name).toBe(true);
    } finally {
      await server.close();
    }
  }, 120_000);

  it("type-checks with its own tsconfig", async () => {
    expect(await typecheck(dir)).toEqual({ code: 0, output: "" });
  }, 60_000);

  it("type-checks without the examples too (src/scripts is never empty)", async () => {
    expect(await typecheck(bareDir)).toEqual({ code: 0, output: "" });
  }, 60_000);
});

describe("the starter project with a website (--storefront, no examples)", () => {
  it("has a config that validates: a same-host workbench at /workbench/, built for that path", async () => {
    const config = await loadConfig(siteDir);
    expect(config.storefront).toMatchObject({ pagesDir: "./pages", outDir: "./site", workbenchUrl: "/workbench/",
      site: { title: "Starter Check", footer: "Made with Pattern Dump." } });
    expect(config.build?.basePath).toBe("/workbench/");
  });

  it("audits with zero static defects, and its skin and component render", async () => {
    const config = await loadConfig(siteDir);
    const { graph } = await runDiagnosticsAudit(config, siteDir);
    expect(graph.occurrences).toEqual([]);
    expect(graph.components.map(c => [c.id, c.render]).sort()).toEqual(
      [["components/note", "ok"], ["layouts/listing", "ok"], ["layouts/page", "ok"], ["partials/base", "ok"], ["partials/head", "ok"]]);
  }, 120_000);

  it("serves the website: the home page with its placed note, the about page, the 404 page and robots.txt", async () => {
    const config = await loadConfig(siteDir);
    const server = await startDevServer(config, siteDir, { port: 0, wsPort: 0 });
    try {
      const home = await onHost(server.port, "live.localhost", "/");
      expect(home.status).toBe(200);
      expect(home.body).toContain("<title>Home — Starter Check</title>");
      expect(home.body).toContain(`<aside class="note note-tip" role="note">`);
      expect(home.body).toContain(`<iframe src="/preview/components/note"`);
      expect(home.body).toContain(`<a rel="next" href="/about/">Next: About</a>`);
      expect((await onHost(server.port, "live.localhost", "/about/")).status).toBe(200);
      // The articles collection: its listing names the example article with its date, and the article shows its tags.
      const articles = await onHost(server.port, "live.localhost", "/articles/");
      expect(articles.status).toBe(200);
      expect(articles.body).toMatch(/<a class="listing-title" href="\/articles\/hello\/">Hello, articles<\/a>\s*<time class="listing-date" datetime="2026-11-14">/);
      const hello = await onHost(server.port, "live.localhost", "/articles/hello/");
      expect(hello.status).toBe(200);
      expect(hello.body).toContain(`<ul class="page-tags" aria-label="Tags"><li>getting-started</li><li>notes</li></ul>`);
      const missing = await onHost(server.port, "live.localhost", "/no-such-page/");
      expect(missing.status).toBe(404);
      expect(missing.body).toContain("Page not found");
      expect((await onHost(server.port, "live.localhost", "/robots.txt")).body)
        .toBe("User-agent: *\nDisallow: /preview/\nDisallow: /workbench/preview/\n");
      expect((await onHost(server.port, "pd.localhost", "/components/note")).status).toBe(200);
    } finally {
      await server.close();
    }
  }, 120_000);

  it("type-checks with its own tsconfig", async () => {
    expect(await typecheck(siteDir)).toEqual({ code: 0, output: "" });
  }, 60_000);

  it("writes a photo in a page's prose with its variants, in the slot the starter's layout declares", async () => {
    await save(join(siteDir, "assets", "images", "flat.png"), flatPng(1600, 1000, [40, 90, 160]));
    await save(join(siteDir, "pages", "photo.md"), `---\ntitle: Photo\norder: 99\n---\n\n![A flat blue field](/assets/images/flat.png)\n`);
    const config = await loadConfig(siteDir);
    const server = await startDevServer(config, siteDir, { port: 0, wsPort: 0 });
    try {
      const page = await onHost(server.port, "live.localhost", "/photo/");
      expect(page.status).toBe(200);
      const img = /<img [^>]*>/.exec(page.body)?.[0] ?? "";
      expect(img).toContain(`sizes="auto, (min-width: 44rem) 42rem, calc(100vw - 2rem)"`);
      expect(img).toContain(`width="1344" height="840" alt="A flat blue field" loading="lazy" decoding="async"`);
      const srcset = /srcset="([^"]+)"/.exec(img)![1]!.split(",").map(c => c.trim().split(/\s+/));
      expect(srcset.map(([, w]) => w)).toEqual(["480w", "672w", "1344w"]);
      for (const [url] of srcset) expect((await onHost(server.port, "live.localhost", url!)).status, url).toBe(200);
    } finally {
      await server.close();
    }
  }, 120_000);
});

// The README's "Try breaking it" step, done as it says on a running server: the page then shows the
// problem with its place in the file, and comes back by itself once the value is saved back.
describe("the website starter's README step: break a pd- tag, then fix it", () => {
  it("shows the problem on the page with file, line and column, then the note again", async () => {
    const readme = await readFile(join(cliDir, "templates", "storefront-fills", "readme.md"), "utf8");
    const step = /change `tone="(\w+)"` to `tone="(\w+)"`/.exec(readme.replace(/\s+/g, " "));
    expect(step, "the README names the value to change and the one to try").not.toBeNull();
    const [, good, bad] = step!;
    const target = await scaffold(false, true);
    try {
      const file = join(target, "pages", "index.md");
      const page = await readFile(file, "utf8");
      const lines = page.split("\n");
      const at = lines.findIndex(l => l.startsWith("<pd-components-note ") && l.includes(`tone="${good}"`));
      expect(at, `the home page places the note with tone="${good}"`).toBeGreaterThanOrEqual(0);
      const where = `index.md:${at + 1}:${lines[at].indexOf("tone=") + 1}`;

      const server = await startDevServer(await loadConfig(target), target, { port: 0, wsPort: 0 });
      try {
        const home = () => onHost(server.port, "live.localhost", "/");
        expect((await home()).body).toContain(`<aside class="note note-${good}" role="note">`);
        lines[at] = lines[at].replace(`tone="${good}"`, `tone="${bad}"`);
        await save(file, lines.join("\n"));
        await expect.poll(async () => (await home()).body, { timeout: 10_000 })
          .toContain(`${where}: &lt;pd-components-note&gt;.tone must be one of "tip", "warning" (got "${bad}")`);
        await save(file, page);
        await expect.poll(async () => (await home()).body, { timeout: 10_000 })
          .toContain(`<aside class="note note-${good}" role="note">`);
      } finally {
        await server.close();
      }
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  }, 60_000);
});
