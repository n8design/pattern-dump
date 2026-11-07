// A request takes the discovery once and uses only that, and an invalidation during a build is never
// overwritten by that build's result (server-state.ts, hazard 4). Both moments are produced with the
// test-only hook `__testOnly_onDiscovery`, on a served copy of the storefront bench with no watcher, so
// the only invalidation is the one a test makes.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

type Hook = (phase: "built" | "taken", invalidate: () => void) => void | Promise<void>;
const setHook = (hook: Hook | undefined) => {
  (globalThis as { __testOnly_onDiscovery?: Hook }).__testOnly_onDiscovery = hook;
};

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let tmp = "";
let root = "";
let server: DevServer;

/** GET with an explicit Host header. */
function get(host: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${host}:${server.port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-discovery-race-"));
  root = join(tmp, "bench");
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  server = await startDevServer(validateConfig(benchConfig, "storefront-bench"), root, { port: 0, live: false });
}, 60_000);
afterEach(() => setHook(undefined));
afterAll(async () => {
  setHook(undefined);
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("the discovery a request takes", () => {
  it("is invalidated mid-request: the page still renders, 200, from the discovery it took", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(" ")); });
    let fired = false;
    setHook((phase, invalidate) => {
      if (phase === "taken" && !fired) { fired = true; invalidate(); }
    });
    try {
      const page = await get("live.localhost", "/");
      expect(fired).toBe(true);
      expect(page.status).toBe(200);
      expect(page.body).toContain(`<h1 class="page-title">Storefront bench</h1>`);
      // The layout's partials, linked through the composition built from the discovery the request took.
      expect(page.body).toContain(`<link rel="stylesheet" href="/_pd/components/partials/base.css" data-pd-comp="partials/base">`);
      expect(page.body).toContain(`<link rel="stylesheet" href="/_pd/components/partials/nav.css" data-pd-comp="partials/nav">`);
      expect(errors.filter(e => e.includes("Unhandled request error"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("is invalidated mid-build: the next request sees the new discovery, not that build's", async () => {
    // Empty the cache, so the next request builds.
    let emptied = false;
    setHook((phase, invalidate) => { if (phase === "taken" && !emptied) { emptied = true; invalidate(); } });
    await get("127.0.0.1", "/api/tree");
    expect(emptied).toBe(true);

    // During that build: a component arrives, and the watcher would invalidate.
    let built = false;
    setHook(async (phase, invalidate) => {
      if (phase !== "built" || built) return;
      built = true;
      await mkdir(join(root, "src/patterns/components/zz-late"), { recursive: true });
      await writeFile(join(root, "src/patterns/components/zz-late/zz-late.hbs"), "<p>late</p>\n");
      invalidate();
    });
    const during = await get("127.0.0.1", "/api/tree");
    expect(built).toBe(true);
    expect(during.status).toBe(200);
    expect(during.body).not.toContain("zz-late");

    setHook(undefined);
    const next = await get("127.0.0.1", "/api/tree");
    expect(next.status).toBe(200);
    expect(next.body).toContain("zz-late");
  });
});
