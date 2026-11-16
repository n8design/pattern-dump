// A component schema that isn't valid JSON fails wherever it can matter, naming its file, line and column and saying
// the component isn't checked against it until it's fixed: a SCHEMA_INVALID error on the component in the workbench;
// a site-wide problem on every pd dev site page; and in pd build, with or without a site, it stops the build before
// anything is written. Before, it read as "no schema" and turned the component's checks off with no word.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import type { ComponentDetailResponse } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let tmp = "";
const servers: DevServer[] = [];

async function write(root: string, rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await save(join(root, rel), text);
}

const base = {
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel" as const, dir: "./src/styles" },
};
const withSite = validateConfig(defineConfig({
  ...base, storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://workbench.example.test/" },
}), "site");
const workbenchOnly = validateConfig(defineConfig(base), "ds");

/** GET with an explicit Host header (fetch ignores an overridden one). */
const get = (port: number, host: string, path: string): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  request({ host: "127.0.0.1", port, path, headers: { host: `${host}:${port}` } }, res => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", c => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
  }).on("error", reject).end();
});

// A missing comma after the first property (line 5, column 5); the component itself is not used by any page.
const BROKEN = `{\n  "type": "object",\n  "properties": {\n    "label": { "type": "string" }\n    "size": { "type": "number" }\n  }\n}\n`;
const FILE = "src/patterns/atoms/broken/broken.schema.json";
/** The problem as the site and pd build list it; the parser's own reason in the middle. */
const PROBLEM = new RegExp(`^${FILE.replace(/[.]/g, "\\.")}:5:5: not valid JSON \\([^)]+\\), so atoms/broken isn't checked against its schema until it's fixed$`);

async function project(name: string, site: boolean): Promise<string> {
  const root = join(tmp, name);
  await write(root, "src/patterns/atoms/broken/broken.hbs", `<p class="broken">{{label}}</p>\n`);
  await write(root, "src/patterns/atoms/broken/broken.json", `{ "label": "Hi" }\n`);
  await write(root, FILE, BROKEN);
  await mkdir(join(root, "src", "styles"), { recursive: true });
  if (site) {
    await write(root, "src/patterns/layouts/page/page.hbs", `<main>{{{body}}}</main>\n`);
    await write(root, "src/patterns/layouts/page/page.schema.json", JSON.stringify({ type: "object", properties: { title: { type: "string" } } }));
    await write(root, "pages/index.md", "---\ntitle: Home\n---\n\nHello.\n");
  }
  return root;
}

let siteRoot = "";
let dsRoot = "";
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-schema-invalid-"));
  siteRoot = await project("site", true);
  dsRoot = await project("ds", false);
});
afterAll(async () => {
  await Promise.all(servers.map(s => s.close()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a component schema that isn't valid JSON", () => {
  it("in the workbench: a SCHEMA_INVALID error at its file, line and column", async () => {
    const server = await startDevServer(withSite, siteRoot, { port: 0, live: false });
    servers.push(server);
    const detail = await (await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/broken`)).json() as ComponentDetailResponse;
    const found = detail.diagnostics.filter(d => d.kind === "SCHEMA_INVALID");
    expect(found).toEqual([expect.objectContaining({ severity: "error", location: { file: FILE, line: 5, column: 5 } })]);
  });

  it("on a pd dev site page: a site-wide problem, though no page uses the component", async () => {
    const server = await startDevServer(withSite, siteRoot, { port: 0, live: false });
    servers.push(server);
    const page = await get(server.port, "live.localhost", "/");
    expect(page.status).toBe(500);
    const items = [...page.body.matchAll(/<li data-pd-site>([^<]*)<\/li>/g)].map(m => m[1]!.replace(/&#39;/g, "'"));
    expect(items).toEqual([expect.stringMatching(PROBLEM)]);
  });

  it("in pd build with a site: stops, and writes nothing", async () => {
    const out = join(tmp, "site-wb");
    const error = await buildStaticSite(withSite, siteRoot, { outDir: out, pdVersion: "0.0.0-test" }).then(() => null, (e: unknown) => e as Error);
    expect(error?.message.split("\n")[0]).toBe("pd build: a component schema isn't valid JSON, so nothing was written:");
    expect(error?.message.split("\n").slice(1).map(l => l.replace(/^ {2}- /, ""))).toEqual([expect.stringMatching(PROBLEM)]);
    expect([existsSync(out), existsSync(join(siteRoot, "site"))]).toEqual([false, false]);
  });

  it("in pd build of a workbench alone: stops, and writes nothing", async () => {
    const out = join(tmp, "ds-wb");
    const error = await buildStaticSite(workbenchOnly, dsRoot, { outDir: out, pdVersion: "0.0.0-test" }).then(() => null, (e: unknown) => e as Error);
    expect(error?.message.split("\n").slice(1).map(l => l.replace(/^ {2}- /, ""))).toEqual([expect.stringMatching(PROBLEM)]);
    expect(existsSync(out)).toBe(false);
  });
});
