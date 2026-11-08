// @pattern-dump/hotreloader
// ws-based HMR server. The browser side lives in apps/dev-ui (app/hmr.ts), typed against the same
// HmrMessage union this pushes.
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { PD_PROTOCOL_VERSION, type HmrMessage } from "@pattern-dump/contracts";

export interface HotReloader {
  push(message: HmrMessage): void;
  /**
   * Send one change's messages, in order, with one bump of the generation: every reload message among them
   * carries the same generation. The watcher sends each handler's reload messages this way when the
   * handler has finished, so all the state it changed is in place before any of them leaves.
   */
  pushChange(messages: HmrMessage[]): void;
  /**
   * Replace the set of STANDING messages every new connection receives right after `hello`.
   *
   * `push` only reaches sockets open at that moment, so a condition detected before the browser
   * connected — a handle collision found at startup — would otherwise never be seen. Retained
   * messages describe current state, not events: pass the full current set each time (an empty
   * array clears it).
   */
  retain(messages: HmrMessage[]): void;
  /**
   * The current live-reload generation (`PD_GENERATION_HEADER` in contracts): `<boot>.<n>`, `n` counting
   * the changes sent so far: `pushChange` bumps it once for a change's messages, `push` once for a single
   * reload message. Either must be called after the change's state is in place; a request takes it before
   * anything else.
   */
  generation(): string;
  /** The port it is bound to, once `listening` has resolved: with 0, the one the system chose. Before that,
   *  the port it was given. */
  readonly port: number;
  /**
   * Settles once the socket is bound: resolves when listening, rejects with the bind error (e.g.
   * EADDRINUSE). Await it before relying on the reloader. Without it a bind failure surfaced only as
   * an unhandled 'error' event, which crashed the whole process with a raw stack trace.
   */
  readonly listening: Promise<void>;
  close(): Promise<void>;
}

export function createHotReloader(port = Number(process.env["PD_WS_PORT"] ?? 4001)): HotReloader {
  const wss = new WebSocketServer({ port });
  const clients = new Set<WebSocket>();
  const listening = new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });
  // A caller that never awaits `listening` must not turn a bind failure into an unhandled rejection;
  // one that does still sees the rejection. Later server errors are per-connection and never fatal.
  listening.catch(() => {});
  wss.on("error", () => {});
  let retained: HmrMessage[] = [];
  // This process, and the reload messages sent so far.
  const boot = randomUUID().slice(0, 8);
  let sent = 0;
  const generation = (): string => `${boot}.${sent}`;
  const isReload = (m: HmrMessage): boolean =>
    m.type === "content-swap" || m.type === "css-link-swap" || m.type === "tree-changed" || m.type === "page-changed";
  const send = (data: string): void => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  };

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
    // First frame on every connection, so the shell can detect a protocol mismatch.
    const hello: HmrMessage = { type: "hello", protocol: PD_PROTOCOL_VERSION, generation: generation() };
    ws.send(JSON.stringify(hello));
    for (const message of retained) ws.send(JSON.stringify(message));
  });

  return {
    get port(): number {
      const address = wss.address();
      return address !== null && typeof address === "object" ? address.port : port;
    },
    listening,
    push(message: HmrMessage) {
      // A reload message moves the generation on, and carries the one it moved it to.
      const reload = isReload(message);
      if (reload) sent++;
      send(JSON.stringify(reload ? { ...message, generation: generation() } : message));
    },
    pushChange(messages: HmrMessage[]) {
      if (messages.some(isReload)) sent++;
      for (const m of messages) send(JSON.stringify(isReload(m) ? { ...m, generation: generation() } : m));
    },
    generation,
    retain(messages: HmrMessage[]) {
      retained = [...messages];
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
