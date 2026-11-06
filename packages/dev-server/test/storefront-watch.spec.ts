// pd dev watches the storefront's pages folder: an edited page reloads itself (page-changed with its
// route), a page or file added or removed reloads every page (route null). Asserted on the real HMR
// socket, against a copy of the bench, so the repo is never written to.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const config = validateConfig(benchConfig, "storefront-bench");
const servers: DevServer[] = [];
const sockets: WebSocket[] = [];
let tmp = "";

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

async function benchCopy(name: string): Promise<string> {
  const root = join(tmp, name);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  return root;
}

type Message = { type: string; route?: string | null };
/** A live server on `root`, and the messages its socket sends. */
async function watch(root: string, cfg: PatternDumpConfig): Promise<Message[]> {
  const wsPort = await freePort();
  servers.push(await startDevServer(cfg, root, { port: 0, wsPort }));
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  sockets.push(ws);
  const messages: Message[] = [];
  ws.on("message", (data: Buffer) => messages.push(JSON.parse(data.toString()) as Message));
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  return messages;
}

/** Do something, then wait until a message matches (or, with `none`, that none does for a while). */
async function after(messages: Message[], act: () => Promise<void>, match: (m: Message) => boolean, none = false): Promise<Message[]> {
  const from = messages.length;
  await act();
  const deadline = Date.now() + (none ? 1_000 : 10_000);
  while (Date.now() < deadline) {
    if (!none && messages.slice(from).some(match)) break;
    await new Promise(r => setTimeout(r, 50));
  }
  return messages.slice(from).filter(match);
}
const pageChanged = (m: Message) => m.type === "page-changed";

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-watch-")); });
afterAll(async () => {
  for (const ws of sockets) ws.close();
  await Promise.all(servers.map(s => s.close()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("pd dev reloads storefront pages", () => {
  let root = "";
  let messages: Message[] = [];
  beforeAll(async () => {
    root = await benchCopy("watched");
    messages = await watch(root, config);
  }, 120_000);
  const pages = (...p: string[]) => join(root, "pages", ...p);

  it("sends an edited page's route", async () => {
    expect(await after(messages, () => appendFile(pages("about.md"), "\nMore.\n"), pageChanged)).toEqual([{ type: "page-changed", route: "/about/" }]);
    expect(await after(messages, () => appendFile(pages("index.md"), "\nMore.\n"), pageChanged)).toEqual([{ type: "page-changed", route: "/" }]);
    expect(await after(messages, () => appendFile(pages("guides", "setup.md"), "\nMore.\n"), pageChanged)).toEqual([{ type: "page-changed", route: "/guides/setup/" }]);
  });

  it("reloads every page when a page is added or removed", async () => {
    expect(await after(messages, () => writeFile(pages("contact.md"), "---\ntitle: Contact\n---\n"), pageChanged)).toEqual([{ type: "page-changed", route: null }]);
    expect(await after(messages, () => rm(pages("contact.md")), pageChanged)).toEqual([{ type: "page-changed", route: null }]);
  });

  it("reloads every page when a file that is not a page, or a folder, appears", async () => {
    expect(await after(messages, () => writeFile(pages("notes.txt"), "x"), pageChanged)).toEqual([{ type: "page-changed", route: null }]);
    expect((await after(messages, () => mkdir(pages("news")), pageChanged))[0]).toEqual({ type: "page-changed", route: null });
  });

  it("ignores dotfiles", async () => {
    expect(await after(messages, () => writeFile(pages(".DS_Store"), "x"), pageChanged, true)).toEqual([]);
  });

  it("sends no page-changed for a component's docs, which keep their own reload", async () => {
    const docs = join(root, "src", "patterns", "components", "callout", "callout.md");
    const sent = await after(messages, () => appendFile(docs, "\nMore.\n"), m => m.type === "tree-changed" || pageChanged(m));
    expect(sent.some(m => m.type === "tree-changed")).toBe(true);
    expect(sent.filter(pageChanged)).toEqual([]);
  });
});

describe("a pages folder beside the patterns, with a name that starts the same", () => {
  it("is still the pages folder, not part of the patterns", async () => {
    const root = await benchCopy("sibling");
    await rename(join(root, "pages"), join(root, "src", "patterns-site"));
    const cfg = validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, pagesDir: "./src/patterns-site" } }, "sibling");
    const messages = await watch(root, cfg);
    const sent = await after(messages, () => appendFile(join(root, "src", "patterns-site", "about.md"), "\nMore.\n"), m => pageChanged(m) || m.type === "tree-changed");
    expect(sent).toEqual([{ type: "page-changed", route: "/about/" }]);
  }, 120_000);
});
