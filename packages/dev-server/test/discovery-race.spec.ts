// A request takes the discovery once and uses only that, and a build an invalidation overtook is never
// stored or handed out: its request waits for the build after it (server-state.ts, hazard 4; lazy.ts).
// Both moments are produced with the test-only hook `__testOnly_onLazy`, on a served copy of the
// storefront bench with no watcher, so the only invalidation is the one a test makes.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

/** Append `text` to `path`, as one save of the whole file. */
const append = async (path: string, text: string) => save(path, `${await readFile(path, "utf8")}${text}`);

type Hook = (phase: "built" | "taken", invalidate: () => void) => void | Promise<void>;
type LazyHook = (name: string, phase: "built" | "taken", invalidate: () => void) => void | Promise<void>;
/** Hook the discovery's lazy cache only. */
const setHook = (hook: Hook | undefined) => {
  (globalThis as { __testOnly_onLazy?: LazyHook }).__testOnly_onLazy =
    hook && ((name, phase, invalidate) => (name === "discovery" ? hook(phase, invalidate) : undefined));
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

  it("is invalidated mid-build: that build is never handed out, and its request gets the one after it", async () => {
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
      await save(join(root, "src/patterns/components/zz-late/zz-late.hbs"), "<p>late</p>\n");
      invalidate();
    });
    // The request that started the overtaken build waits for the next one, which has seen the change.
    const during = await get("127.0.0.1", "/api/tree");
    expect(built).toBe(true);
    expect(during.status).toBe(200);
    expect(during.body).toContain("zz-late");

    setHook(undefined);
    const next = await get("127.0.0.1", "/api/tree");
    expect(next.status).toBe(200);
    expect(next.body).toContain("zz-late");
  });
});

describe("the composition registry a request uses", () => {
  /** The ids a component's template includes, as its detail reports them. */
  const uses = async (id: string): Promise<string[]> => {
    const r = await get("127.0.0.1", `/api/component/${id}`);
    expect(r.status).toBe(200);
    return (JSON.parse(r.body) as { relationships: { uses?: string[] } }).relationships.uses ?? [];
  };

  it("is the one built for its discovery: an include added while it was built is in the next request's", async () => {
    // Empty the cache, so the next request builds a discovery and its registry.
    let emptied = false;
    setHook((phase, invalidate) => { if (phase === "taken" && !emptied) { emptied = true; invalidate(); } });
    expect(await uses("components/callout")).toEqual([]);
    expect(emptied).toBe(true);

    // While that registry is built: the template gains an include, and the watcher would invalidate.
    let edited = false;
    (globalThis as { __testOnly_onLazy?: (name: string, phase: string, invalidate: () => void) => Promise<void> }).__testOnly_onLazy =
      async (name, phase, invalidate) => {
        if (name !== "composition" || phase !== "built" || edited) return;
        edited = true;
        await append(join(root, "src/patterns/components/callout/callout.hbs"), "{{> partials-nav }}\n");
        invalidate();
      };
    // That request keeps the registry of the discovery it took, read before the edit.
    expect(await uses("components/callout")).toEqual([]);
    expect(edited).toBe(true);

    setHook(undefined);
    // The next one takes the new discovery and gets its own registry, which has the include.
    expect(await uses("components/callout")).toEqual(["partials/nav"]);
  });
});
