// Storefront pages as the built dev server serves them, on the storefront's own host. Requests set Host
// explicitly through node:http — fetch() silently ignores an overridden Host header.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInContext, createContext } from "node:vm";
import WebSocket from "ws";
import { defineConfig, validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { startOnFreeWsPort } from "./free-ports.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const bench = join(repo, "storefront-bench");
const config = validateConfig(benchConfig, "storefront-bench");
const servers: DevServer[] = [];
let tmp = "";

afterAll(async () => {
  await Promise.all(servers.map(s => s.close()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
});


/** GET with an explicit Host header. */
function get(port: number, host: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host: `${host}:${port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function serve(root: string, cfg: PatternDumpConfig, live = false): Promise<{ port: number; wsPort: number }> {
  const { server, wsPort } = live ? await startOnFreeWsPort(cfg, root)
    : { server: await startDevServer(cfg, root, { port: 0, live }), wsPort: 0 };
  servers.push(server);
  return { port: server.port, wsPort };
}

/** A copy of the bench's tracked files, to change without touching the repo. */
async function benchCopy(name: string): Promise<string> {
  const root = join(tmp, name);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  return root;
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-serve-")); });

describe("storefront pages on the storefront host", () => {
  let port = 0;
  beforeAll(async () => { ({ port } = await serve(bench, config)); }, 120_000);

  it("serves every page at its route, /about as /about/, and the page list", async () => {
    for (const [path, title] of [["/", "Storefront bench"], ["/about/", "About — Storefront bench"], ["/about", "About — Storefront bench"], ["/guides/setup/", "Setup — Storefront bench"]]) {
      const r = await get(port, "live.localhost", path);
      expect(r.status, path).toBe(200);
      expect(r.body, path).toContain(`<title>${title}</title>`);
    }
    const pages = JSON.parse((await get(port, "live.localhost", "/api/pages")).body) as { pages: Array<{ route: string }> };
    expect(pages.pages.map(p => p.route)).toEqual(["/", "/guides/", "/guides/setup/", "/about/"]);
    expect((await get(port, "live.localhost", "/nope/")).status).toBe(404);
  });

  it("links to the workbench of this same process, not the build's workbenchUrl", async () => {
    const { body } = await get(port, "live.localhost", "/");
    expect(config.storefront?.workbenchUrl).toBe("https://workbench.example.test/");
    expect(body).toContain(`href="http://pd.localhost:${port}/components/callout"`);
    expect(body).not.toContain("workbench.example.test");
  });

  it("serves the workbench on pd.localhost and on plain localhost", async () => {
    for (const host of ["pd.localhost", "localhost", "127.0.0.1"]) {
      const r = await get(port, host, "/");
      expect(r.body, host).toContain("<title>Pattern Dump Dev</title>");
      expect((await get(port, host, "/api/pages")).status, host).toBe(404);
    }
  });

  it("serves a page script that runs the height fitter on its own, from the built server", async () => {
    const { body } = await get(port, "live.localhost", "/");
    const start = body.indexOf("var createHeightFitter=(") + "var createHeightFitter=(".length;
    const end = body.indexOf(");var fitter=", start);
    const source = body.slice(start, end);
    expect(source.startsWith("function createHeightFitter(")).toBe(true);
    // A fresh context: no module, no globals of this test.
    const factory = runInContext(`(${source})`, createContext({ WeakMap, WeakSet })) as (a: object) => { accept(f: object, h: number): boolean; reset(f: object): void };
    const log: string[] = [];
    const fit = factory({ write: (_f: object, h: number) => log.push(`write ${h}`), onCircular: () => log.push("circular"), onReset: () => log.push("reset") });
    const frame = {};
    const results = [200, 900, 900, 1800, 3600, 7200].map(h => fit.accept(frame, h));
    fit.reset(frame);
    results.push(fit.accept(frame, 300));
    // accept (200, 900, 900, 1800), park at the steady height (3600 -> 900), ignore (7200), start over after reset.
    expect({ log, results }).toEqual({
      log: ["write 200", "write 900", "write 900", "write 1800", "write 900", "circular", "reset", "write 300"],
      results: [true, true, true, true, true, false, true],
    });
  });

  it("loads only its own stylesheets: no shell CSS, no --pd- token, as served", async () => {
    const { body } = await get(port, "live.localhost", "/");
    const head = body.slice(0, body.indexOf("</head>"));
    const hrefs = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).not.toContain("/_pd/main.css");
    for (const href of hrefs) {
      const css = await get(port, "live.localhost", href);
      expect(css.status, href).toBe(200);
      expect(css.body, href).not.toContain("--pd-");
    }
    expect(head).not.toContain("/_pd/main.css");
  });
});

describe("no preview theme layer in a page's head", () => {
  it("links no theme on a page, while the same project's preview does", async () => {
    const root = await benchCopy("themed");
    await mkdir(join(root, "themes"), { recursive: true });
    await writeFile(join(root, "themes", "light.theme.scss"), ":root { --tone: #222; }\n");
    const { port } = await serve(root, { ...config, themes: { dir: "./themes", default: "light" } });
    const preview = await get(port, "pd.localhost", "/preview/components/callout");
    expect(preview.body).toContain(`href="/_pd/themes/light.css"`);
    const page = await get(port, "live.localhost", "/");
    expect(page.status).toBe(200);
    expect(page.body).not.toContain("/_pd/themes/");
  }, 120_000);
});

describe("pages with problems, in pd dev", () => {
  let root = "";
  let port = 0;
  beforeAll(async () => {
    root = await benchCopy("problems");
    await writeFile(join(root, "pages", "about.md"), "---\ntitle: About\nbogus: <b>x</b>\n---\n\n```pattern components/nope\n```\n");
    ({ port } = await serve(root, config, true));
  }, 120_000);

  it("answers with every problem, escaped, and the live client", async () => {
    const r = await get(port, "live.localhost", "/about/");
    expect(r.status).toBe(500);
    expect(r.body).toContain(`<li>about.md:3: &quot;bogus&quot; is not declared by layout &quot;page&quot;</li>`.replace(/&quot;/g, `"`));
    expect(r.body).toContain("<li>about.md: pattern components/nope: there is no such component</li>");
    expect(r.body).toContain("<script data-pd-live>");
    // The other pages are fine.
    expect((await get(port, "live.localhost", "/")).status).toBe(200);
  });
});

describe("rendering a page leaves the workbench's selection alone (state.lastComponentId)", () => {
  it("keeps the component the workbench last fetched as the one a style edit refreshes", async () => {
    const root = await benchCopy("selection");
    const { port, wsPort } = await serve(root, config, true);
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
    const swaps: Array<{ orderedHrefs?: string[] }> = [];
    ws.on("message", (data: Buffer) => { const m = JSON.parse(data.toString()) as { type: string; orderedHrefs?: string[] }; if (m.type === "css-link-swap") swaps.push(m); });

    const editAndWait = async (file: string): Promise<string[]> => {
      swaps.length = 0;
      await writeFile(file, `${await readFile(file, "utf8")}\n.edited-${Date.now()} { color: red; }\n`);
      const deadline = Date.now() + 10_000;
      while (!swaps.some(s => s.orderedHrefs) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      return (swaps.find(s => s.orderedHrefs)?.orderedHrefs ?? []).map(h => h.replace(/\?v=.*$/, ""));
    };
    const calloutScss = join(root, "src", "styles", "components", "callout.scss");

    // The workbench selects the callout; then a storefront page is rendered; then the callout's styles change.
    expect((await get(port, "pd.localhost", "/api/component/components/callout")).status).toBe(200);
    expect((await get(port, "live.localhost", "/")).status).toBe(200);
    expect(await editAndWait(calloutScss)).toEqual(["/_pd/components/components/callout.css"]);

    // The control: had the selection moved to the page's layout, the refresh would carry the layout's CSS.
    expect((await get(port, "pd.localhost", "/api/component/layouts/page")).status).toBe(200);
    expect(await editAndWait(calloutScss)).toContain("/_pd/components/partials/base.css");
    ws.close();
  }, 120_000);
});

describe("without a storefront config, every host is the workbench, as before", () => {
  it("answers every host the same on test-bench", async () => {
    const testBench = join(repo, "test-bench");
    const tbConfig = defineConfig({
      sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
      styles: { strategy: "parallel", dir: "./src/styles" },
      themes: { dir: "./themes", default: "light", switch: "attribute" },
      assets: { strategy: "central", dir: "./assets" }, scriptsDir: "./src/scripts", helpers: "./src/helpers",
      dataDir: "./src/_data", packages: ["pd-fixture-ui"],
    });
    const { port } = await serve(testBench, tbConfig);
    for (const path of ["/", "/about/", "/atoms/button", "/api/pages", "/preview/atoms/button"]) {
      const answers = await Promise.all(["localhost", "live.localhost", "pd.localhost", "127.0.0.1"].map(h => get(port, h, path)));
      for (const a of answers.slice(1)) expect({ path, status: a.status, body: a.body }).toEqual({ path, status: answers[0].status, body: answers[0].body });
    }
    expect((await get(port, "live.localhost", "/api/pages")).status).toBe(404);
  }, 120_000);
});
