// @pattern-dump/hotreloader
// ws-based HMR server. The browser side lives in apps/dev-ui (app/hmr.ts), typed against the same
// HmrMessage union this pushes.
import { WebSocket, WebSocketServer } from "ws";
import { PD_PROTOCOL_VERSION, type HmrMessage } from "@pattern-dump/contracts";

export interface HotReloader {
  push(message: HmrMessage): void;
  /**
   * Replace the set of STANDING messages every new connection receives right after `hello`.
   *
   * `push` only reaches sockets open at that moment, so a condition detected before the browser
   * connected — a handle collision found at startup — would otherwise never be seen. Retained
   * messages describe current state, not events: pass the full current set each time (an empty
   * array clears it).
   */
  retain(messages: HmrMessage[]): void;
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

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
    // First frame on every connection, so the shell can detect a protocol mismatch.
    const hello: HmrMessage = { type: "hello", protocol: PD_PROTOCOL_VERSION };
    ws.send(JSON.stringify(hello));
    for (const message of retained) ws.send(JSON.stringify(message));
  });

  return {
    port,
    listening,
    push(message: HmrMessage) {
      const data = JSON.stringify(message);
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    },
    retain(messages: HmrMessage[]) {
      retained = [...messages];
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
