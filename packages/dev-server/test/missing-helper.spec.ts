// A helper a template calls but nobody registered is a listed problem everywhere it can appear, with the
// helper's name and the template that calls it: a RENDER_ERROR diagnostic on the component in the
// workbench; a listed problem on the pd dev storefront page, never an unhandled 500; and in pd build,
// fatal for a storefront page and listed before anything is written.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
let root = "";
const servers: DevServer[] = [];

async function write(rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await save(join(root, rel), text);
}

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://workbench.example.test/" },
}), "site");

/** GET with an explicit Host header (fetch ignores an overridden one). */
const get = (port: number, host: string, path: string): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  request({ host: "127.0.0.1", port, path, headers: { host: `${host}:${port}` } }, res => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", c => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
  }).on("error", reject).end();
});

const WHISPER = `Missing helper "whisper", called by partials/base (line 1, column 19)`;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-missing-helper-"));
  root = join(tmp, "site");
  await write("src/patterns/atoms/chip/chip.hbs", `<span class="chip">{{shout "x"}}</span>\n`);
  await write("src/patterns/layouts/page/page.hbs", `{{#> partials-base}}<main>{{{body}}}</main>{{/partials-base}}\n`);
  await write("src/patterns/layouts/page/page.schema.json", JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }));
  await write("src/patterns/partials/base/base.hbs", `<div class="site">{{whisper "y"}}{{> @partial-block}}</div>\n`);
  await mkdir(join(root, "src", "styles"), { recursive: true });
  await write("pages/index.md", "---\ntitle: Home\n---\n\nHello.\n");
});
afterAll(async () => {
  await Promise.all(servers.map(s => s.close()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a missing helper", () => {
  it("in the workbench: a RENDER_ERROR on the component, naming the helper and the template, with where", async () => {
    const server = await startDevServer(config, root, { port: 0, live: false });
    servers.push(server);
    const detail = await (await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/chip`)).json() as ComponentDetailResponse;
    expect(detail.diagnostics).toEqual([{
      kind: "RENDER_ERROR", severity: "error", source: "render",
      message: `Missing helper "shout", called by atoms/chip (line 1, column 20)`,
      location: { file: "src/patterns/atoms/chip/chip.hbs", line: 1, column: 20 },
    }]);
  });

  it("on a pd dev storefront page: listed in the error page, never an unhandled 500", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(" ")); });
    try {
      const server = await startDevServer(config, root, { port: 0, live: false });
      servers.push(server);
      const page = await get(server.port, "live.localhost", "/");
      expect(page.status).toBe(500);
      expect(page.body).toContain(`<li>index.md: ${WHISPER}</li>`);
      expect(page.body).not.toContain("Internal Server Error");
      expect(errors.filter(l => l.includes("Unhandled request error"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("in pd build: fatal for a storefront page, listed with every other problem, and nothing written", async () => {
    const out = join(tmp, "wb");
    await expect(buildStaticSite(config, root, { outDir: out, pdVersion: "0.0.0-test" })).rejects.toThrow(
      `pd build: the storefront has problems, so nothing was written:\n  - /: index.md: ${WHISPER}`,
    );
    expect([existsSync(out), existsSync(join(root, "site"))]).toEqual([false, false]);
  });
});
