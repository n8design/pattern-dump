// What pd dev's watcher sends for every kind of change, pinned as it is: on a copy of test-bench (with its
// pattern package linked as npm links a `file:` dependency) and of the storefront bench, one live server
// each, the workbench showing one component.
//
// Deterministic, with no waiting for quiet. Each case declares the watcher events its act causes. After
// the act the step waits until the watcher has handled those (the dev-server's test-only hook,
// `__testOnly_onEventHandled`), then edits a sentinel file and waits until that is handled with no handler
// still running: every event the act caused has then been handled. A WebSocket ping then proves every
// message sent so far has arrived (frames on one socket arrive in order). The step asserts the events
// handled were exactly the declared ones, and compares its messages, sorted (handlers for one change may
// finish in either order), with cache-busting stamps (?v=…) and the copy's folder normalised.
//
// New files are written beside the copy and renamed into place, so each appears in one event: written in
// place, the OS can report the creation and the write apart (pinned on its own below).
//
// A characterization: it records the behaviour before the watcher is reworked, and must pass unedited
// after a change that is not meant to alter it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";
import storefrontConfig from "../../../storefront-bench/pattern-dump.config.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const SENTINEL = "src/patterns/zz-sentinel.txt";
const servers: DevServer[] = [];
const sockets: WebSocket[] = [];
let tmp = "";

// Every watcher event handled, from both servers (they share this process), as the hook reports it.
type Handled = { event: string; path: string; stillRunning: number };
const handled: Handled[] = [];
let waiters: Array<() => void> = [];
(globalThis as { __testOnly_onEventHandled?: (event: string, path: string, stillRunning: number) => void })
  .__testOnly_onEventHandled = (event, path, stillRunning) => {
    handled.push({ event, path, stillRunning });
    const ws = waiters; waiters = []; ws.forEach(w => w());
  };
/** Resolve when `test` holds over the handled events, checked on each new one. */
function whenHandled(test: () => boolean): Promise<void> {
  return new Promise(resolve => {
    const check = () => { if (test()) resolve(); else waiters.push(check); };
    check();
  });
}

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

/** The tracked files of a repo folder, copied to `<tmp>/<name>`. */
async function copyOf(folder: string, name: string): Promise<string> {
  const root = join(tmp, name);
  for (const file of execFileSync("git", ["ls-files", folder], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice(folder.length + 1));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  await writeFile(join(root, SENTINEL), "");
  return root;
}

let staged = 0;
/** A served copy: its socket's messages, and the acts a case can take on it. */
class Bench {
  messages: string[] = [];
  private ws!: WebSocket;
  private port = 0;
  constructor(readonly root: string, private readonly component: string) {}

  async start(cfg: PatternDumpConfig): Promise<void> {
    const wsPort = await freePort();
    const server = await startDevServer(cfg, this.root, { port: 0, wsPort });
    servers.push(server);
    this.port = server.port;
    this.ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    sockets.push(this.ws);
    this.ws.on("message", (data: Buffer) => this.messages.push(data.toString().replace(/\?v=\d+/g, "?v=<t>").split(this.root).join("<root>")));
    await new Promise<void>((resolve, reject) => { this.ws.once("open", () => resolve()); this.ws.once("error", reject); });
  }

  at(rel: string): string { return join(this.root, rel); }
  edit(rel: string, text: string): Promise<void> { return appendFile(this.at(rel), text); }
  remove(rel: string): Promise<void> { return rm(this.at(rel), { recursive: true }); }
  /** A new file, written beside the copy and renamed into place, so it appears complete, in one event. */
  async create(rel: string, text: string): Promise<void> {
    const staging = join(tmp, "staging", String(staged++));
    await mkdir(dirname(staging), { recursive: true });
    await writeFile(staging, text);
    await mkdir(dirname(this.at(rel)), { recursive: true });
    await rename(staging, this.at(rel));
  }

  /** The workbench asks for its component again, as it does after every reload. */
  async reopen(): Promise<void> { await fetch(`http://127.0.0.1:${this.port}/api/component/${this.component}`); }

  /** The events handled for this copy since `from`, as [event, path in the copy], the sentinel's left out. */
  handledSince(from: number): string[][] {
    return handled.slice(from).filter(h => h.path.startsWith(this.root + "/"))
      .map(h => [h.event, relative(this.root, h.path)]).filter(([, p]) => p !== SENTINEL);
  }

  /** Until every event so far is handled and every message sent so far has arrived. */
  async barrier(): Promise<void> {
    const from = handled.length;
    await this.edit(SENTINEL, ".");
    const mine = (h: Handled) => h.path.startsWith(this.root + "/");
    await whenHandled(() => {
      const after = handled.slice(from);
      const at = after.findIndex(h => h.path === this.at(SENTINEL));
      return at >= 0 && after.slice(at).some(h => mine(h) && h.stillRunning === 0);
    });
    await new Promise<void>(resolve => { this.ws.once("pong", () => resolve()); this.ws.ping(); });
  }

  /** Act, wait for its declared events to be handled, then the barrier; its messages and events. */
  async step(act: () => Promise<void>, events: string[][]): Promise<{ messages: string[]; events: string[][] }> {
    await this.reopen();
    await this.barrier();
    const from = this.messages.length;
    const hFrom = handled.length;
    await act();
    await whenHandled(() => events.every(([event, rel]) => handled.slice(hFrom).some(h => h.event === event && h.path === this.at(rel))));
    await this.barrier();
    const messages = this.messages.slice(from).filter(m => !m.startsWith('{"type":"hello"')).sort();
    return { messages, events: this.handledSince(hFrom) };
  }
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-watch-char-")); });
afterAll(async () => {
  for (const ws of sockets) ws.close();
  await Promise.all(servers.map(s => s.close()));
  delete (globalThis as { __testOnly_onEventHandled?: unknown }).__testOnly_onEventHandled;
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

type Case = [name: string, act: () => Promise<void>, events: string[][], messages: string[]];

describe("the watcher on test-bench", () => {
  const b = new Bench("", "atoms/button");
  beforeAll(async () => {
    Object.assign(b, { root: await copyOf("test-bench", "test-bench") });
    await mkdir(b.at("node_modules"), { recursive: true });
    await symlink(join("..", "packages", "pd-fixture-ui"), b.at("node_modules/pd-fixture-ui"));
    await b.start(validateConfig(testBenchConfig, "test-bench"));
  }, 120_000);

  const CASES: Case[] = [
    // Pins a known bug, see follow-up; change this case when the bug is fixed. (A template shared by
    // data-overlay variants sends content-swap only for the last variant using it.)
    ["a template", () => b.edit("src/patterns/atoms/button/button.hbs", "\n"), [["change", "src/patterns/atoms/button/button.hbs"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button~secondary\"}",
    ]],
    ["its data", () => b.edit("src/patterns/atoms/button/button.json", "\n"), [["change", "src/patterns/atoms/button/button.json"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    ["its docs", () => b.edit("src/patterns/atoms/button/button.md", "\nMore.\n"), [["change", "src/patterns/atoms/button/button.md"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    ["its stylesheet", () => b.edit("src/styles/01-atoms/button.scss", "\n.tb-char { color: red; }\n"), [["change", "src/styles/01-atoms/button.scss"]], [
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/button\",\"href\":\"/_pd/components/atoms/button.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"molecules/field\",\"href\":\"/_pd/components/molecules/field.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
    ]],
    ["a base partial", () => b.edit("src/styles/00-base/_tokens.scss", "\n$tb-char: 1;\n"), [["change", "src/styles/00-base/_tokens.scss"]], [
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/button\",\"href\":\"/_pd/components/atoms/button.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/icon\",\"href\":\"/_pd/components/atoms/icon.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/input\",\"href\":\"/_pd/components/atoms/input.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/responsive-demo\",\"href\":\"/_pd/components/atoms/responsive-demo.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"molecules/field\",\"href\":\"/_pd/components/molecules/field.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"molecules/media\",\"href\":\"/_pd/components/molecules/media.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"organisms/buttonbar\",\"href\":\"/_pd/components/organisms/buttonbar.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"organisms/card\",\"href\":\"/_pd/components/organisms/card.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"organisms/toolbar\",\"href\":\"/_pd/components/organisms/toolbar.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"pages/homepage\",\"href\":\"/_pd/components/pages/homepage.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
    ]],
    ["a base stylesheet", () => b.edit("src/styles/00-base/shared-family.scss", "\n.tb-char-base { color: red; }\n"), [["change", "src/styles/00-base/shared-family.scss"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    ["a theme", () => b.edit("themes/light.theme.scss", "\n:root { --tb-char: 1; }\n"), [["change", "themes/light.theme.scss"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    ["a script", () => b.edit("src/scripts/toggle.ts", "\n"), [["change", "src/scripts/toggle.ts"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    ["a new component", () => b.create("src/patterns/atoms/zz-char/zz-char.hbs", "<p>char</p>\n"), [["addDir", "src/patterns/atoms/zz-char"], ["add", "src/patterns/atoms/zz-char/zz-char.hbs"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    ["its new docs", () => b.create("src/patterns/atoms/zz-char/zz-char.md", "---\ntitle: Char\n---\n"), [["add", "src/patterns/atoms/zz-char/zz-char.md"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/zz-char\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    ["its new stylesheet", () => b.create("src/styles/01-atoms/zz-char.scss", ".zz-char { color: red; }\n"), [["add", "src/styles/01-atoms/zz-char.scss"]], [
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/zz-char\",\"href\":\"/_pd/components/atoms/zz-char.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
    ]],
    ["removing its docs", () => b.remove("src/patterns/atoms/zz-char/zz-char.md"), [["unlink", "src/patterns/atoms/zz-char/zz-char.md"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/zz-char\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    ["removing its template", () => b.remove("src/patterns/atoms/zz-char/zz-char.hbs"), [["unlink", "src/patterns/atoms/zz-char/zz-char.hbs"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/zz-char\",\"href\":\"/_pd/components/atoms/zz-char.css?v=<t>\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    ["removing its folder", () => b.remove("src/patterns/atoms/zz-char"), [["unlinkDir", "src/patterns/atoms/zz-char"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    ["global data", () => b.edit("src/_data/tb.json", "\n"), [], []],
    ["a helper", () => b.edit("src/helpers/hbs.cjs", "\n"), [], []],
    ["an asset", () => b.create("assets/images/zz-char.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n"), [], []],
    ["a package template", () => b.edit("packages/pd-fixture-ui/patterns/atoms/fixture-chip/fixture-chip.hbs", "\n"), [], []],
    ["a package stylesheet", () => b.edit("packages/pd-fixture-ui/sass/01-atoms/_fixture-chip.scss", "\n.fx-char { color: red; }\n"), [], []],
  ];
  for (const [name, act, events, messages] of CASES) {
    it(`sends what it sends for ${name}`, async () => {
      expect(await b.step(act, events)).toEqual({ messages, events });
    }, 20_000);
  }

  it("handles a file created empty and then written as two events, add then change, dropping neither", async () => {
    // What the OS sometimes reports for one write of a new file, made to happen: the file appears empty,
    // the watcher handles that, then its content is written.
    const rel = "src/patterns/atoms/zz-split/zz-split.hbs";
    const warn = vi.spyOn(console, "warn");
    try {
      const result = await b.step(async () => {
        const from = handled.length;
        await mkdir(b.at("src/patterns/atoms/zz-split"), { recursive: true });
        await writeFile(b.at(rel), "");
        await whenHandled(() => handled.slice(from).some(h => h.event === "add" && h.path === b.at(rel)));
        await writeFile(b.at(rel), "<p>split</p>\n");
      }, [["addDir", "src/patterns/atoms/zz-split"], ["add", rel], ["change", rel]]);
      expect(result.events).toEqual([["addDir", "src/patterns/atoms/zz-split"], ["add", rel], ["change", rel]]);
      // The change is handled, not dropped: its content-swap names the new component. (The new component's
      // full restyle also picks up the package stylesheet the case before edited, which is not watched.)
      expect(result.messages).toEqual([
        "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
        "{\"type\":\"content-swap\",\"componentId\":\"atoms/zz-split\"}",
        "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/fixture-chip\",\"href\":\"/_pd/components/atoms/fixture-chip.css?v=<t>\"}",
        "{\"type\":\"tree-changed\"}",
      ]);
      expect(warn.mock.calls.map(c => c.join(" ")).filter(m => m.includes("zz-split"))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  }, 20_000);
});

describe("the watcher on the storefront bench", () => {
  const b = new Bench("", "components/callout");
  beforeAll(async () => {
    Object.assign(b, { root: await copyOf("storefront-bench", "storefront-bench") });
    await b.start(validateConfig(storefrontConfig, "storefront-bench"));
  }, 120_000);

  const CASES: Case[] = [
    ["a page", () => b.edit("pages/about.md", "\nMore.\n"), [["change", "pages/about.md"]], [
      "{\"type\":\"page-changed\",\"route\":\"/about/\"}",
    ]],
    ["a new page", () => b.create("pages/zz-char.md", "---\ntitle: Char\n---\n"), [["add", "pages/zz-char.md"]], [
      "{\"type\":\"page-changed\",\"route\":null}",
    ]],
    ["removing it", () => b.remove("pages/zz-char.md"), [["unlink", "pages/zz-char.md"]], [
      "{\"type\":\"page-changed\",\"route\":null}",
    ]],
    ["a layout", () => b.edit("src/patterns/layouts/page/page.hbs", "\n"), [["change", "src/patterns/layouts/page/page.hbs"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"layouts/page\"}",
    ]],
    ["a partial's stylesheet", () => b.edit("src/styles/partials/footer.scss", "\n.zz-char { color: red; }\n"), [["change", "src/styles/partials/footer.scss"]], [
      "{\"type\":\"css-link-swap\",\"componentId\":\"partials/footer\",\"href\":\"/_pd/components/partials/footer.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/components/callout.css?v=<t>\"]}",
    ]],
    ["a base-layer file", () => b.edit("src/styles/site/tokens.scss", "\n:root { --wf-char: 1; }\n"), [["change", "src/styles/site/tokens.scss"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"components/callout\"}",
      "{\"type\":\"page-changed\",\"route\":\"/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/about/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/guides/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/guides/setup/\"}",
    ]],
    ["a new base-layer file", () => b.create("src/styles/site/zz-char.scss", ".site { --wf-char2: 1; }\n"), [["add", "src/styles/site/zz-char.scss"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"components/callout\"}",
      "{\"type\":\"page-changed\",\"route\":\"/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/about/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/guides/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/guides/setup/\"}",
    ]],
    ["the component's data", () => b.edit("src/patterns/components/callout/callout.json", "\n"), [["change", "src/patterns/components/callout/callout.json"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"components/callout\"}",
    ]],
  ];
  for (const [name, act, events, messages] of CASES) {
    it(`sends what it sends for ${name}`, async () => {
      expect(await b.step(act, events)).toEqual({ messages, events });
    }, 20_000);
  }
});
