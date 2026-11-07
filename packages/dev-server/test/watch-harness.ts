// A harness for watcher specs: a served project, its HMR socket's messages, and acts on its files, with
// no waiting for quiet. The dev-server calls the test-only hook `__testOnly_onEventHandled` when each
// watcher event's handler has finished; a step waits until the events its act causes are handled, then
// edits a sentinel file and waits until that is handled with no handler still running (every event so
// far has been handled), then pings the socket (frames on one socket arrive in order, so every message
// sent so far has arrived). New files are written beside the project and renamed into place, so each
// appears in one event.
import { appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative } from "node:path";
import WebSocket from "ws";
import type { PatternDumpConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";

/** A file in the patterns folder whose edits the watcher handles and ignores: the barrier's sentinel. */
export const SENTINEL = "src/patterns/zz-sentinel.txt";

// Every watcher event handled, from every server in this process, as the hook reports it.
type Handled = { event: string; path: string; stillRunning: number };
export const handled: Handled[] = [];
let waiters: Array<() => void> = [];
(globalThis as { __testOnly_onEventHandled?: (event: string, path: string, stillRunning: number) => void })
  .__testOnly_onEventHandled = (event, path, stillRunning) => {
    handled.push({ event, path, stillRunning });
    const ws = waiters; waiters = []; ws.forEach(w => w());
  };

/** Resolve when `test` holds over the handled events, checked on each new one. */
export function whenHandled(test: () => boolean): Promise<void> {
  return new Promise(resolve => {
    const check = () => { if (test()) resolve(); else waiters.push(check); };
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

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

let staged = 0;
/** A served project: its socket's messages, and the acts a case can take on it. */
export class Bench {
  messages: string[] = [];
  private ws!: WebSocket;
  private port = 0;
  /** `staging`: a folder outside every watched one, where new files are written before they're moved in. */
  constructor(readonly root: string, private readonly component: string, private readonly staging: string) {}

  async start(cfg: PatternDumpConfig): Promise<void> {
    await mkdir(dirname(this.at(SENTINEL)), { recursive: true });
    await writeFile(this.at(SENTINEL), "");
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

  /** The workbench asks for its component again, as it does after every reload. */
  async reopen(): Promise<void> { await fetch(`http://127.0.0.1:${this.port}/api/component/${this.component}`); }

  /** The events handled for this project since `from`, as [event, path in the project], the sentinel's left out. */
  handledSince(from: number): string[][] {
    return handled.slice(from).filter(h => this.owns(h.path))
      .map(h => [h.event, this.rel(h.path)]).filter(([, p]) => p !== SENTINEL);
  }

  /** Until every event so far is handled and every message sent so far has arrived. */
  async barrier(): Promise<void> {
    const from = handled.length;
    await this.edit(SENTINEL, ".");
    const mine = (h: Handled) => this.owns(h.path);
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
    await whenHandled(() => events.every(([event, rel]) => handled.slice(hFrom).some(h => h.event === event && this.owns(h.path) && this.rel(h.path) === rel)));
    await this.barrier();
    const messages = this.messages.slice(from).filter(m => !m.startsWith('{"type":"hello"')).sort();
    return { messages, events: this.handledSince(hFrom) };
  }
}
