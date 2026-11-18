// A symbol image's standalone file, /_pd/symbols/<stem>.svg: the symbol with the base layer's token values written
// in, light, then dark by prefers-color-scheme, and currentColor as a token (assets.symbols.currentColor). pd build
// writes it into each output; a symbol that can't be used, or whose token the base layer lacks, stops the build
// before anything is written.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { buildStaticSite, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";
import { FLOW } from "./symbol-fixtures.js";

const COLORS = `:root {\n  color-scheme: light dark;\n  --color-primary: light-dark(#0b5cad, #7ab8ff);\n  --color-text: light-dark(#1b1b1f, #eceef2);\n`
  + `  --color-heading: #101010;\n}\n`;
const config = (extra: Partial<PatternDumpConfig> = {}): PatternDumpConfig => defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: ["./src/assets", "./more/assets"] },
  storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://workbench.example.test/" },
  ...extra,
});
const exists = (p: string) => stat(p).then(() => true, () => false);
let tmp = "";
let n = 0;

async function project(files: Record<string, string> = {}): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, body] of Object.entries({
    "src/styles/base/colors.scss": COLORS,
    "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "src/assets/symbols/flow.svg": FLOW,
    "pages/index.md": `---\ntitle: Home\n---\n\n![A flow](#flow)\n`,
    ...files,
  })) await save(join(root, rel), body);
  return root;
}

function get(server: DevServer, path: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-symbol-export-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("/_pd/symbols/<stem>.svg", () => {
  it("is the symbol with its tokens' light and dark values, currentColor as --color-text", async () => {
    const server = await startDevServer(config(), await project(), { port: 0, live: false });
    try {
      const r = await get(server, "/_pd/symbols/flow.svg");
      expect(r.status).toBe(200);
      expect(r.type).toBe("image/svg+xml; charset=utf-8");
      expect(r.body.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><style>`
        + `:root { --color-primary: #0b5cad; --color-text: #1b1b1f; } `
        + `@media (prefers-color-scheme: dark) { :root { --color-primary: #7ab8ff; --color-text: #eceef2; } }</style>`)).toBe(true);
      expect(r.body).not.toMatch(/currentColor/i);
      expect(r.body).toContain(`<rect x="300" y="90" width="40" height="20" fill="var(--color-text)">`);
      expect((await get(server, "/_pd/symbols/none.svg")).status).toBe(404);
      expect((await get(server, "/_pd/symbols/../flow.svg")).status).toBe(404);
    } finally { await server.close(); }
  });

  it("assets.symbols.currentColor names the token currentColor becomes", async () => {
    const server = await startDevServer(config({ assets: { dir: "./src/assets", symbols: { currentColor: "--color-heading" } } }),
      await project(), { port: 0, live: false });
    try {
      const r = await get(server, "/_pd/symbols/flow.svg");
      expect(r.body).toContain(`--color-heading: #101010;`);
      expect(r.body).toContain(`fill="var(--color-heading)"`);
    } finally { await server.close(); }
  });

  it("a token the base layer lacks is a 500 naming it", async () => {
    const server = await startDevServer(config(), await project({
      "src/assets/symbols/odd.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect fill="var(--color-missing)"/></svg>`,
    }), { port: 0, live: false });
    try {
      const r = await get(server, "/_pd/symbols/odd.svg");
      expect(r.status).toBe(500);
      expect(r.body).toBe("/_pd/symbols/odd.svg: --color-missing is not in the base layer");
    } finally { await server.close(); }
  });
});

describe("pd build and symbol images", () => {
  it("writes every symbol's file into both outputs, with its warnings and overrides in the report", async () => {
    const root = await project({
      "src/assets/symbols/unused.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect onclick="x()" fill="none"/></svg>`,
      "more/assets/symbols/flow.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect fill="#000"/></svg>`,
    });
    const report = await buildStaticSite(config(), root, { outDir: join(root, "workbench"), pdVersion: "0.0.0-test" });
    for (const out of ["workbench", "site"]) {
      const flow = await readFile(join(root, out, "_pd", "symbols", "flow.svg"), "utf8");
      expect(flow, out).toContain("--color-primary: #0b5cad;");
      expect(await exists(join(root, out, "_pd", "symbols", "unused.svg")), out).toBe(true);
    }
    expect(report.warnings).toContain("src/assets/symbols/unused.svg: removed onclick attributes");
    expect(report.notes).toContain(`src/assets/symbols/flow.svg overrides more/assets/symbols/flow.svg, a symbol of the same name ("flow")`);
    // The page's sprite is the project's symbol, not the hidden one.
    expect(await readFile(join(root, "site", "index.html"), "utf8")).toContain(`<symbol id="img-flow" viewBox="0 0 400 200">`);
  });

  it("a symbol that can't be used, or whose token the base layer lacks, stops it with nothing written", async () => {
    const root = await project({
      "src/assets/symbols/odd.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect fill="var(--color-missing)"/></svg>`,
      "src/assets/symbols/hex.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect fill="#f00"/></svg>`,
    });
    await expect(buildStaticSite(config(), root, { outDir: join(root, "workbench"), pdVersion: "0.0.0-test" })).rejects.toThrow(
      `pd build: a symbol image can't be used, so nothing was written:\n`
      + `  - src/assets/symbols/hex.svg: <rect> fill="#f00" is not a colour token: write var(--color-…) or currentColor (or none, transparent)\n`
      + `  - /_pd/symbols/odd.svg: --color-missing is not in the base layer`);
    expect(await exists(join(root, "workbench"))).toBe(false);
    expect(await exists(join(root, "site"))).toBe(false);
  });
});
