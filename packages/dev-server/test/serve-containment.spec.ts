// Every route that maps part of a URL to a file answers only with files inside the folder it serves from:
// a request that names a file outside it, whether with "..", an encoded separator, a backslash or a link that
// points out, gets a 404 and nothing of the file. Requests go over node:http with the path as written, since
// a URL parser would fold some of these before they reach the server.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import type { DevServer } from "@pattern-dump/dev-server";
import { freePort, startOnFreeWsPort } from "./free-ports.js";
import { save } from "../../../test-support/save.js";

const MARKER = "PD-SECRET-MARKER";

/** GET `path` exactly as written, with `host` as the Host header. */
const get = (port: number, path: string, host: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host: `${host}:${port}` } }, res => {
      let body = ""; res.setEncoding("utf8"); res.on("data", c => { body += c; }); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject); req.end();
  });

/** "..", written as each way a route might decode back into one. */
const UPS: Array<[string, (n: number) => string]> = [
  ["..%2f", n => "..%2f".repeat(n)],
  ["%2e%2e%2f", n => "%2e%2e%2f".repeat(n)],
  ["%2E%2E%2F", n => "%2E%2E%2F".repeat(n)],
  [".%2e%2f", n => ".%2e%2f".repeat(n)],
  ["..%5c (backslash)", n => "..%5c".repeat(n)],
  ["..\\ (raw backslash)", n => "..\\".repeat(n)],
];

let tmp = "", project = "";
let server: DevServer;
beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "pd-serve-contained-")));
  project = join(tmp, "p");
  for (const [rel, text] of Object.entries({
    "src/patterns/atoms/chip/chip.hbs": "<p>chip</p>\n",
    "src/styles/atoms/chip.scss": "p { margin: 0; }\n",
    "src/assets/images/a.txt": "an asset\n",
    "src/brand/logo.txt": "a brand asset\n",
    "src/scripts/ok.ts": "export const ok = 1;\n",
    "pages/index.md": "---\ntitle: Home\n---\n\nHi.\n",
  })) {
    await mkdir(dirname(join(project, rel)), { recursive: true });
    await save(join(project, rel), text);
  }
  await save(join(tmp, "secret.txt"), `${MARKER}\n`);
  await save(join(tmp, "secret.ts"), `export const s = "${MARKER}";\n`);
  // Links inside the roots that point out of them.
  await symlink(join(tmp, "secret.txt"), join(project, "src/assets/out.txt"));
  await symlink(join(tmp, "secret.ts"), join(project, "src/scripts/out.ts"));
  const config = validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    assets: { dir: ["./src/assets", "./src/brand"] }, scriptsDir: "./src/scripts",
    storefront: { pagesDir: "./pages", outDir: "./.out/storefront" },
  }), "containment");
  server = (await startOnFreeWsPort(config, project)).server;
}, 60_000);
afterAll(async () => {
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

/** Refused: a 404, and nothing of the secret in the answer. */
async function refused(path: string, host = "pd.localhost"): Promise<void> {
  const r = await get(server.port, path, host);
  expect(r.body, path).not.toContain(MARKER);
  expect(r.status, path).toBe(404);
}

describe("pd dev serves files only from inside each route's folder", () => {
  it("/assets/ still serves its files, from the mirror and from a named root", async () => {
    expect(await get(server.port, "/assets/assets/images/a.txt", "pd.localhost")).toMatchObject({ status: 200, body: "an asset\n" });
    expect(await get(server.port, "/assets/brand/logo.txt", "pd.localhost")).toMatchObject({ status: 200, body: "a brand asset\n" });
    expect(await get(server.port, "/assets/images/a.txt", "pd.localhost")).toMatchObject({ status: 200, body: "an asset\n" });
  });

  // src/assets → ../../secret.txt
  for (const [label, up] of UPS) {
    it(`/assets/ refuses ${label}, from the mirror and from a named root`, async () => {
      await refused(`/assets/${up(3)}secret.txt`);
      await refused(`/assets/assets/${up(3)}secret.txt`);
      await refused(`/assets/brand/${up(3)}secret.txt`);
    });
  }

  it("/assets/ refuses a link inside the root that points outside it, and a malformed escape", async () => {
    await refused("/assets/out.txt");
    await refused("/assets/assets/out.txt");
    await refused("/assets/%E0%A4%A.txt");
  });

  it("/_pd/scripts/ still compiles a script inside its folder", async () => {
    const r = await get(server.port, "/_pd/scripts/ok.js", "pd.localhost");
    expect(r.status).toBe(200);
    expect(r.body).toContain("ok");
  });

  it("/_pd/scripts/ refuses a way out, and a link inside its folder that points outside it", async () => {
    for (const [, up] of UPS) await refused(`/_pd/scripts/${up(3)}secret.js`);
    await refused("/_pd/scripts/out.js");
  });

  it("routes that look a name up instead of reading a path give nothing of a file outside", async () => {
    for (const [, up] of UPS) {
      for (const path of [`/_pd/components/${up(4)}secret.txt.css`, `/_pd/themes/${up(4)}secret.css`, `/preview/${up(4)}secret`,
        `/source/${up(4)}secret/rendered`, `/source/${up(4)}secret/data`, `/api/component/${up(4)}secret`]) {
        const r = await get(server.port, path, "pd.localhost");
        expect(r.body, path).not.toContain(MARKER);
      }
      await refused(`/${up(3)}secret/`, "live.localhost");
    }
  });
});

describe("the static server the E2E suites serve built roots with", () => {
  const script = fileURLToPath(new URL("../../../apps/dev-ui/e2e/static-server.mjs", import.meta.url));
  let child: ChildProcess;
  let port = 0;
  let site = "";
  beforeAll(async () => {
    site = join(tmp, "site");
    await mkdir(join(site, "about"), { recursive: true });
    await save(join(site, "index.html"), "home");
    await save(join(site, "about", "index.html"), "about");
    // A sibling whose name starts with the root's: a prefix check would let it through.
    await mkdir(join(tmp, "site-other"), { recursive: true });
    await save(join(tmp, "site-other", "x.txt"), MARKER);
    await symlink(join(tmp, "secret.txt"), join(site, "out.txt"));
    port = await freePort();
    child = spawn(process.execPath, [script, "--dir", site, "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve, reject) => {
      child.stdout!.on("data", (d: Buffer) => { if (String(d).includes("static-server:")) resolve(); });
      child.once("exit", code => reject(new Error(`static-server exited with ${code}`)));
    });
  }, 30_000);
  afterAll(() => { child?.kill(); });

  const fetchRaw = (path: string) => get(port, path, "127.0.0.1");

  it("still serves the root's files and folder pages", async () => {
    expect(await fetchRaw("/")).toMatchObject({ status: 200, body: "home" });
    expect(await fetchRaw("/about/")).toMatchObject({ status: 200, body: "about" });
  });

  it("refuses every way out of the root, a sibling sharing its name, and a link pointing out", async () => {
    for (const [, up] of UPS) {
      for (const path of [`/${up(1)}secret.txt`, `/${up(1)}site-other/x.txt`, `/about/${up(2)}secret.txt`]) {
        const r = await fetchRaw(path);
        expect(r.body, path).not.toContain(MARKER);
        expect(r.status, path).toBe(404);
      }
    }
    const link = await fetchRaw("/out.txt");
    expect([link.status, link.body.includes(MARKER)]).toEqual([404, false]);
  });
});
