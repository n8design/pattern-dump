// A harness for watcher specs: a served project, its HMR socket's messages, and acts on its files, with
// no waiting for quiet. The dev-server calls the test-only hook `__testOnly_onEventHandled` when each
// watcher event's handler has finished. A step waits until the events its act causes are handled, then
// for its barrier: a `.__testOnly_barrier` file (a dotfile, which every reader of a folder skips) in every watched folder (the project's and each linked
// package's), all edited, all handled (the watcher reports them and handles nothing), and then no handler
// still running. The OS orders events within a folder, not across folders, hence one per folder. Then a
// socket ping: frames on one socket arrive in order, so every message sent so far has arrived. New files
// are written beside the project and renamed into place, so each appears in one event.
import { appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import WebSocket from "ws";
import type { PatternDumpConfig } from "@pattern-dump/config";
import type { DevServer } from "@pattern-dump/dev-server";
import { startOnFreeWsPort } from "./free-ports.js";
import { loadPatternPackages } from "../src/packages.js";
import { resolveServerConfig } from "../src/server-config.js";
import { watchedRoots } from "../src/watch-roots.js";

/** The barrier's file: in every watched folder, reported by the watcher and never handled. */
const BARRIER = ".__testOnly_barrier";

// Every watcher event handled, from every server in this process, as the hook reports it.
type Handled = { event: string; path: string; stillRunning: number };
export const handled: Handled[] = [];
let waiters: Array<() => void> = [];
(globalThis as { __testOnly_onEventHandled?: (event: string, path: string, stillRunning: number) => void })
  .__testOnly_onEventHandled = (event, path, stillRunning) => {
    handled.push({ event, path, stillRunning });
    const ws = waiters; waiters = []; ws.forEach(w => w());
  };

/** How long a latch waits before it fails, saying what it waited for: well under a test's timeout. */
export const LATCH_MS = 5_000;

/**
 * Resolve when `test` holds over the handled events, checked on each new one. Rejects after `LATCH_MS`
 * with `what()`: what it waited for and what arrived instead.
 */
export function whenHandled(test: () => boolean, what: () => string = () => "the expected events"): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      waiters = waiters.filter(w => w !== check);
      reject(new Error(`latch: not handled within ${LATCH_MS} ms: ${what()}`));
    }, LATCH_MS);
    const check = () => {
      if (done) return;
      if (test()) { done = true; clearTimeout(timer); resolve(); } else waiters.push(check);
    };
    check();
  });
}

const servers: DevServer[] = [];
const sockets: WebSocket[] = [];
/** Close every server and socket the harness opened, and remove the hook. */
export async function closeAll(): Promise<void> {
  for (const ws of sockets) ws.close();
  await Promise.all(servers.map(s => s.close()));
  delete (globalThis as { __testOnly_onEventHandled?: unknown }).__testOnly_onEventHandled;
}


let staged = 0;
/** A served project: its socket's messages, and the acts a case can take on it. */
export class Bench {
  messages: string[] = [];
  private ws!: WebSocket;
  private port = 0;
  private live = 0;
  private server: DevServer | undefined;
  /** One barrier file per watched folder. */
  private barriers: string[] = [];
  /** `component`: the one the workbench has open, or null for no workbench at all. `staging`: a folder
   *  outside every watched one, where new files are written before they're moved in. */
  constructor(readonly root: string, private readonly component: string | null, private readonly staging: string) {}

  async start(cfg: PatternDumpConfig): Promise<void> {
    // The folders the watcher will watch, as it finds them.
    const rc = resolveServerConfig(cfg, this.root, {}, loadPatternPackages(cfg.packages, this.root));
    const w = watchedRoots(rc);
    const folders = [
      ...w.patterns, ...w.styles.map(r => r.dir), ...w.themes, ...w.scripts, ...w.data, ...w.assets,
      ...w.helpers.map(h => h.scope), ...(rc.storefront?.pagesDir ? [rc.storefront.pagesDir] : []),
    ].filter(d => existsSync(d));
    this.barriers = [...new Set(folders)].map(d => join(d, BARRIER));
    for (const file of this.barriers) await writeFile(file, "");
    const { server, wsPort } = await startOnFreeWsPort(cfg, this.root);
    this.live = wsPort;
    this.server = server;
    servers.push(server);
    this.port = server.port;
    this.ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    sockets.push(this.ws);
    // Normalised for comparison: cache-busters, this project's folder, and the live-reload generation (its
    // own specs check that), which differ on every run.
    this.ws.on("message", (data: Buffer) => this.messages.push(data.toString().replace(/\?v=\d+/g, "?v=<t>")
      .replace(/,"generation":"[^"]*"/g, "").split(this.root).join("<root>")));
    await new Promise<void>((resolve, reject) => { this.ws.once("open", () => resolve()); this.ws.once("error", reject); });
  }

  /** Close this project's socket and server now, rather than with the rest at closeAll: a spec that starts
   *  one per case does not keep them all open, with their watchers and ports, until its end. */
  async close(): Promise<void> {
    this.ws?.close();
    if (this.ws) sockets.splice(sockets.indexOf(this.ws), 1);
    if (this.server) {
      servers.splice(servers.indexOf(this.server), 1);
      await this.server.close();
      this.server = undefined;
    }
  }

  /** The live-reload socket's port, for a socket a spec opens itself. */
  get wsPort(): number { return this.live; }
  /** The server's address, for requests a spec makes itself. */
  get origin(): string { return `http://127.0.0.1:${this.port}`; }
  at(rel: string): string { return join(this.root, rel); }
  /** Whether a watched path is in this project, by either form of its folder: a linked package is watched
   *  from its real path, and the folder may itself sit behind a link (macOS's /var → /private/var). */
  owns(path: string): boolean { return this.forms().some(f => path.startsWith(f + "/")); }
  /** A watched path, relative to this project's folder in whichever form it matches. */
  rel(path: string): string { return relative(this.forms().find(f => path.startsWith(f + "/"))!, path); }
  private forms(): string[] { return [this.root, realpathSync(this.root)]; }

  edit(rel: string, text: string): Promise<void> { return appendFile(this.at(rel), text); }
  remove(rel: string): Promise<void> { return rm(this.at(rel), { recursive: true }); }
  /** A new file, written outside the project and renamed into place, so it appears complete, in one event. */
  async create(rel: string, text: string): Promise<void> {
    const file = join(this.staging, String(staged++));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    await mkdir(dirname(this.at(rel)), { recursive: true });
    await rename(file, this.at(rel));
  }

  /** The workbench asks for its component again, as it does after every reload (with none open, nothing). */
  async reopen(): Promise<void> {
    if (this.component !== null) await fetch(`http://127.0.0.1:${this.port}/api/component/${this.component}`);
  }

  /** The events handled for this project since `from`, as [event, path in the project], the sentinel's left out. */
  handledSince(from: number): string[][] {
    return handled.slice(from).filter(h => this.owns(h.path) && basename(h.path) !== BARRIER)
      .map(h => [h.event, this.rel(h.path)]);
  }

  /** Until every event so far is handled and every message sent so far has arrived. */
  async barrier(): Promise<void> {
    const from = handled.length;
    for (const file of this.barriers) await appendFile(file, ".");
    const mine = (h: Handled) => this.owns(h.path);
    const wanted = this.barriers.map(f => this.rel(f));
    await whenHandled(() => {
      const after = handled.slice(from);
      // The last barrier file handled, then a moment with no handler running.
      const seen = wanted.map(rel => after.findIndex(h => mine(h) && this.rel(h.path) === rel));
      if (seen.some(i => i < 0)) return false;
      return after.slice(Math.max(...seen)).some(h => mine(h) && h.stillRunning === 0);
    }, () => `barrier: ${JSON.stringify(wanted)} each handled, then no handler still running; handled since: ${JSON.stringify(handled.slice(from).filter(mine).map(h => [h.event, this.rel(h.path), h.stillRunning]))}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`latch: no pong within ${LATCH_MS} ms`)), LATCH_MS);
      this.ws.once("pong", () => { clearTimeout(timer); resolve(); });
      this.ws.ping();
    });
  }

  /** Act, wait for its declared events to be handled, then the barrier; its messages and events. */
  async step(act: () => Promise<void>, events: string[][]): Promise<{ messages: string[]; events: string[][] }> {
    await this.reopen();
    await this.barrier();
    const from = this.messages.length;
    const hFrom = handled.length;
    await act();
    await whenHandled(
      () => events.every(([event, rel]) => handled.slice(hFrom).some(h => h.event === event && this.owns(h.path) && this.rel(h.path) === rel)),
      () => `expected ${JSON.stringify(events)}; handled: ${JSON.stringify(this.handledSince(hFrom))}`,
    );
    await this.barrier();
    const messages = this.messages.slice(from).filter(m => !m.startsWith('{"type":"hello"')).sort();
    return { messages, events: this.handledSince(hFrom) };
  }
}
