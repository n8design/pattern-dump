// A response takes the live-reload generation before anything else (PD_GENERATION_HEADER), so a page
// rendered while a change landed carries the generation from before it: behind the one `hello` reports
// afterwards, which is what makes the page reload (the page's own live script; storefront E2E). The page
// request is held with the test-only hook `__testOnly_onLazy` right after it took its discovery; a page is
// edited meanwhile and the real watcher handles it (watch-harness.ts).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { validateConfig } from "@pattern-dump/config";
import { PD_GENERATION_HEADER, generationBehind } from "@pattern-dump/contracts";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";

type LazyHook = (name: string, phase: "built" | "taken", invalidate: () => void) => void | Promise<void>;
const hooks = globalThis as { __testOnly_onLazy?: LazyHook };
const repo = fileURLToPath(new URL("../../../", import.meta.url));

let tmp = "";
let b: Bench;

/** GET with the storefront's Host header (fetch may not set Host). */
function getPage(path: string): Promise<{ status: number; body: string; generation: string | undefined }> {
  return new Promise((resolve, reject) => {
    const port = Number(new URL(b.origin).port);
    const req = request({ host: "127.0.0.1", port, path, headers: { host: `live.localhost:${port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, generation: res.headers[PD_GENERATION_HEADER.toLowerCase()] as string | undefined }));
    });
    req.on("error", reject);
    req.end();
  });
}
/** The generation a socket opened now is told in hello. */
function helloGeneration(): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${b.wsPort}`);
    ws.once("message", d => { ws.close(); resolve((JSON.parse(String(d)) as { generation: string }).generation); });
    ws.once("error", reject);
  });
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-live-generation-"));
  const root = join(tmp, "bench");
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  b = new Bench(root, null, join(tmp, "staging"));
  await b.start(validateConfig(benchConfig, "storefront-bench"));
}, 60_000);
afterEach(() => { delete hooks.__testOnly_onLazy; });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("the live-reload generation a page carries", () => {
  it("is the one its request took first: a change during the render leaves the page behind hello", async () => {
    const about = b.at("pages/about.md");
    const original = await readFile(about, "utf8");
    let edited = false;
    hooks.__testOnly_onLazy = async (name, phase) => {
      if (name !== "discovery" || phase !== "taken" || edited) return;
      edited = true;
      const from = handled.length;
      await writeFile(about, `${original}\nEdited while the home page rendered.\n`);
      await whenHandled(() => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === "pages/about.md"));
    };
    const page = await getPage("/");
    expect(edited).toBe(true);
    expect(page.status).toBe(200);
    const embedded = /var g="([^"]*)"/.exec(page.body)?.[1];
    expect(embedded).toBe(page.generation);
    const now = await helloGeneration();
    expect(generationBehind(page.generation, now)).toBe(true);

    // A page rendered with nothing changing during it is current.
    delete hooks.__testOnly_onLazy;
    const quiet = await getPage("/");
    expect(generationBehind(quiet.generation, await helloGeneration())).toBe(false);
  }, 60_000);
});
