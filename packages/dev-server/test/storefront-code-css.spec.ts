// Code colours on site pages: a page that shows code links /_pd/code.css (the kinds' colours, PD's defaults in the
// pd-code layer, highlight.ts getCodeCSS), before every stylesheet of the site's, so the layer is declared first and
// any rule of the site's wins. A page without code links nothing more. pd dev serves it on the site's host; pd build
// writes it into the site's own _pd/, whether or not it builds the workbench. On copies of the storefront bench:
// guides/setup.md has code blocks, about.md has none.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { getCodeCSS } from "@pattern-dump/renderer";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = new Date("2027-01-02T03:04:05.000Z");
let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-code-css-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
async function benchCopy(): Promise<string> {
  const root = join(tmp, `bench-${n++}`);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  return root;
}

/** The stylesheet links of a page's head, in order. */
const stylesheets = (html: string): string[] =>
  [...(/<head>[\s\S]*?<\/head>/.exec(html)?.[0] ?? "").matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]!);
const LINKED = /^\/_pd\/code\.css\?v=[0-9a-f]+$/;

describe("pd dev: a site page with code", () => {
  let server: DevServer;
  const get = (path: string, host: string): Promise<{ status: number; type: string | undefined; body: string }> => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${host}:${server.port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: res.headers["content-type"], body }));
    });
    req.on("error", reject);
    req.end();
  });
  beforeAll(async () => {
    server = await startDevServer(validateConfig(benchConfig, "storefront-bench"), await benchCopy(), { port: 0, live: false });
  }, 60_000);
  afterAll(async () => { await server?.close(); });

  it("links /_pd/code.css, stamped, as its first stylesheet", async () => {
    const page = await get("/guides/setup/", PD_HOSTS.storefront);
    expect(page.status).toBe(200);
    expect(page.body).toContain(`<span class="pd-code-`);
    const links = stylesheets(page.body);
    expect(links[0]).toMatch(LINKED);
    expect(links.filter(l => l.startsWith("/_pd/code.css"))).toHaveLength(1);
  });

  it("a page without code does not link it", async () => {
    const page = await get("/about/", PD_HOSTS.storefront);
    expect(page.status).toBe(200);
    expect(page.body).not.toContain(`class="shiki-container"`);
    expect(stylesheets(page.body).some(l => l.startsWith("/_pd/code.css"))).toBe(false);
  });

  it("the site's host serves it: the kinds' colours, in the pd-code layer", async () => {
    const css = await get("/_pd/code.css", PD_HOSTS.storefront);
    expect(css.status).toBe(200);
    expect(css.type).toBe("text/css");
    expect(css.body).toBe(getCodeCSS());
    expect(css.body.startsWith("@layer pd-code{:root{--pd-code-text:light-dark(")).toBe(true);
  });

  it("the workbench links it as well", async () => {
    const shell = await get("/", PD_HOSTS.workbench);
    expect(stylesheets(shell.body)).toEqual(["/_pd/code.css", "/_pd/main.css", "/_pd/shiki.css"]);
  });
});

describe("pd build: code.css in the site's own _pd/", () => {
  const config = (over: Partial<PatternDumpConfig> = {}): PatternDumpConfig => validateConfig({ ...benchConfig, ...over }, "test");

  async function built(cfg: PatternDumpConfig): Promise<{ site: string; workbench: string }> {
    const root = await benchCopy();
    const workbench = join(root, "..", `${n}-workbench-out`);
    await buildStaticSite(cfg, root, { outDir: workbench, pdVersion: "0.0.0-test", now: NOW });
    return { site: join(root, ".out", "storefront"), workbench };
  }
  async function expectSite(site: string): Promise<void> {
    expect(await readFile(join(site, "_pd", "code.css"), "utf8")).toBe(getCodeCSS());
    const setup = await readFile(join(site, "guides", "setup", "index.html"), "utf8");
    expect(stylesheets(setup)[0]).toMatch(LINKED);
    expect(stylesheets(await readFile(join(site, "about", "index.html"), "utf8")).some(l => l.startsWith("/_pd/code.css"))).toBe(false);
  }

  it("with the workbench: the site has it, and so does the workbench", async () => {
    const { site, workbench } = await built(config());
    await expectSite(site);
    expect(await readFile(join(workbench, "_pd", "code.css"), "utf8")).toBe(getCodeCSS());
  }, 90_000);

  it("with build.workbench: false: the site has it", async () => {
    const { site } = await built(config({ build: { workbench: false }, site: { ...benchConfig.site!, workbenchUrl: "/workbench/" } }));
    await expectSite(site);
  }, 90_000);
});
