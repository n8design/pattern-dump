// A watcher handler's reload messages leave together when it has finished, with one bump of the live-reload
// generation: every message of one change carries the same generation, and none leaves before the state the
// handler changes is in place, so a page rendered meanwhile is behind them and reloads with that state.
// The second case uses the test-only hook `__testOnly_handler` to run a handler that pushes, then changes
// state, then pushes again.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { validateConfig } from "@pattern-dump/config";
import { PD_GENERATION_HEADER, generationBehind, type HmrMessage } from "@pattern-dump/contracts";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import type { ServerState } from "../src/server-state.js";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

type Api = { push(message: HmrMessage): void; state: ServerState };
const hooks = globalThis as { __testOnly_handler?: (event: string, path: string, api: Api) => Promise<void> | undefined };
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const CSS = "/_pd/components/components/callout.css";

let tmp = "";
let b: Bench;
type Received = HmrMessage & { generation?: string };
/** A socket of our own, raw (no normalising): every frame, and a hook on each. */
async function listen(onFrame: (m: Received) => void = () => {}): Promise<{ frames: Received[]; close: () => void }> {
  const frames: Received[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${b.wsPort}`);
  ws.on("message", d => { const m = JSON.parse(String(d)) as Received; frames.push(m); onFrame(m); });
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  return { frames, close: () => ws.close() };
}
const edited = async (rel: string, text: string) => {
  const from = handled.length;
  await save(b.at(rel), text);
  await whenHandled(() => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === rel));
  await b.barrier();
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-change-batch-"));
  const root = join(tmp, "bench");
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  b = new Bench(root, "components/callout");
  await b.start(validateConfig(benchConfig, "storefront-bench"));
}, 60_000);
afterEach(() => { delete hooks.__testOnly_handler; });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("one change's reload messages", () => {
  it("all carry the same generation, which hello then reports: a page that reloads on the first is current", async () => {
    await b.reopen();
    const socket = await listen();
    const svg = "src/assets/images/bench-blocks.svg";
    const before = socket.frames.length;
    await edited(svg, `${await readFile(b.at(svg), "utf8")}<!-- changed -->\n`);
    const reloads = socket.frames.slice(before).filter(m => m.type !== "hello" && m.type !== "error" && m.type !== "collision");
    socket.close();
    // The open component, and every page.
    expect(reloads.map(m => m.type)).toContain("content-swap");
    expect(reloads.filter(m => m.type === "page-changed").length).toBeGreaterThan(1);
    const generations = new Set(reloads.map(m => m.generation));
    expect(generations.size).toBe(1);
    const later = await listen();
    expect(later.frames[0]).toMatchObject({ type: "hello", generation: [...generations][0] });
    later.close();
  }, 60_000);

  it("leave only once the handler's state is in place: a page rendered after the first push is behind them", async () => {
    let release = (): void => {};
    let entered = (): void => {};
    const inHandler = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    hooks.__testOnly_handler = (event, path, api) => {
      if (!path.endsWith("pages/about.md") || event !== "change") return undefined;
      return (async () => {
        api.push({ type: "css-link-swap", componentId: "components/callout", href: `${CSS}?v=1` });
        entered();
        await gate;
        // State changed after the first push.
        api.state.perComponentCss.set("components/callout", ".callout { color: rgb(9, 8, 7); }");
        api.push({ type: "tree-changed" });
      })();
    };
    // On the swap, the client fetches the stylesheet it names, as a page reloading on it would.
    let fetched: Promise<string> | null = null;
    const socket = await listen(m => {
      if (m.type === "css-link-swap" && !fetched) fetched = fetch(`${b.origin}${CSS}`).then(r => r.text());
    });
    const from = handled.length;
    await save(b.at("pages/about.md"), `${await readFile(b.at("pages/about.md"))}\nChanged.\n`);
    await inHandler;
    // While the handler holds: a page rendered now, and time for any message that left early to arrive.
    const between = await fetch(`${b.origin}/api/version`);
    await new Promise(resolve => setTimeout(resolve, 300));
    release();
    await whenHandled(() => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === "pages/about.md"));
    await b.barrier();
    socket.close();

    const swap = socket.frames.find(m => m.type === "css-link-swap")!;
    expect(fetched).not.toBeNull();
    // The swap left after the state change: the stylesheet it names is the new one.
    expect(await fetched).toContain("rgb(9, 8, 7)");
    // And the page rendered in between is behind it, so it reloads.
    expect(generationBehind(between.headers.get(PD_GENERATION_HEADER), swap.generation)).toBe(true);
  }, 60_000);
});
