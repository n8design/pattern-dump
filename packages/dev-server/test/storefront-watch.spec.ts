// pd dev watches the storefront's pages folder: an edited page reloads itself (page-changed with its
// route), a page or file added or removed reloads every page (route null). Asserted on the real HMR
// socket, against a copy of the bench, so the repo is never written to.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import type { DevServer } from "@pattern-dump/dev-server";
import { startOnFreeWsPort } from "./free-ports.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { Bench, closeAll } from "./watch-harness.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const config = validateConfig(benchConfig, "storefront-bench");
const servers: DevServer[] = [];
const sockets: WebSocket[] = [];
let tmp = "";


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
  const { server, wsPort } = await startOnFreeWsPort(cfg, root);
  servers.push(server);
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

describe("a change to the base layer, with no workbench open", () => {
  // The base layer is in every page's head, so every page changed. Nothing has asked for a component
  // (state.lastComponentId is unset), so the workbench's own reload message has no component to name.
  const everyPage = ["/", "/guides/", "/guides/setup/", "/about/"].map(route => ({ type: "page-changed", route }));
  let root = "";
  let messages: Message[] = [];
  beforeAll(async () => {
    root = await benchCopy("base-layer");
    messages = await watch(root, config);
  }, 120_000);
  const settled = async (act: () => Promise<void>) => {
    await after(messages, act, m => m.type === "page-changed" && m.route === "/about/");
    await new Promise(r => setTimeout(r, 300));
  };

  it("reloads every page when a file is added to it", async () => {
    const from = messages.length;
    await settled(() => writeFile(join(root, "src", "styles", "site", "zz-added.scss"), ".site-footer {\n  letter-spacing: 0.3em;\n}\n"));
    expect(messages.slice(from).filter(pageChanged)).toEqual(everyPage);
  }, 20_000);

  it("reloads every page when one of its files is edited", async () => {
    const from = messages.length;
    await settled(() => appendFile(join(root, "src", "styles", "site", "tokens.scss"), "\n:root {\n  --sk-probe: 1;\n}\n"));
    expect(messages.slice(from).filter(pageChanged)).toEqual(everyPage);
  }, 20_000);
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

describe("script edits and new components, with no workbench open", () => {
  // Storefront pages load scripts and embed components whether or not a workbench is open, so each page
  // is told, page by page (watch-harness.ts: no waiting for quiet).
  afterAll(closeAll);
  const everyPage = ["/", "/about/", "/guides/", "/guides/setup/"].map(route => JSON.stringify({ type: "page-changed", route })).sort();
  async function bench(name: string): Promise<Bench> {
    const root = await benchCopy(name);
    await mkdir(join(root, "src", "scripts"), { recursive: true });
    await writeFile(join(root, "src", "scripts", "zz-tick.ts"), "document.body.dataset.tick = \"1\";\n");
    const b = new Bench(root, null, join(tmp, "staging"));
    await b.start(validateConfig({ ...benchConfig, scriptsDir: "./src/scripts" }, name));
    return b;
  }

  it("reloads every page when a script is edited", async () => {
    const b = await bench("script-edit");
    const r = await b.step(() => b.edit("src/scripts/zz-tick.ts", "\n"), [["change", "src/scripts/zz-tick.ts"]]);
    expect(r.messages).toEqual(everyPage);
  }, 60_000);

  it("reloads every page when a component is added, and when it is removed", async () => {
    const b = await bench("component-added");
    const added = await b.step(() => b.create("src/patterns/components/zz-badge/zz-badge.hbs", "<b>badge</b>\n"),
      [["addDir", "src/patterns/components/zz-badge"], ["add", "src/patterns/components/zz-badge/zz-badge.hbs"]]);
    expect(added.messages).toEqual([...everyPage, JSON.stringify({ type: "tree-changed" })].sort());
    const removed = await b.step(() => b.remove("src/patterns/components/zz-badge/zz-badge.hbs"),
      [["unlink", "src/patterns/components/zz-badge/zz-badge.hbs"]]);
    expect(removed.messages).toEqual([...everyPage, JSON.stringify({ type: "tree-changed" })].sort());
  }, 60_000);
});
