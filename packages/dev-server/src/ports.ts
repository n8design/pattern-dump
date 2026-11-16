// Port conflicts at startup, as one message a person can act on.
//
// `pd dev` binds two ports: the workbench (HTTP) and live reload (WebSocket, default workbench + 1).
// When either is taken — almost always by another `pd dev` still running — Node reports EADDRINUSE
// with a stack trace. This turns it into what happened and how to get past it.

import { connect } from "node:net";

export class PortInUseError extends Error {
  readonly code = "EADDRINUSE";
  constructor(readonly port: number, message: string) {
    super(message);
    this.name = "PortInUseError";
  }
}

const isAddressInUse = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "EADDRINUSE";

/**
 * Re-throw a bind error as a PortInUseError when it is one; anything else passes through untouched.
 * `explicit` says whether the user chose this port (a flag or env var), which changes the advice:
 * a chosen port should be changed directly, a derived one moves with `--port`.
 */
export function describeBindError(
  e: unknown,
  port: number,
  role: "workbench" | "live reload",
  ports: { http: number; wsChosen: boolean },
): unknown {
  if (!isAddressInUse(e)) return e;
  const what = role === "workbench" ? "the workbench" : "live reload";
  const advice = role === "live reload" && ports.wsChosen
    ? "pd dev --ws-port <a free port>"
    : `pd dev --port ${ports.http + 100}   (live reload then uses ${ports.http + 101})`;
  return new PortInUseError(port,
    `Port ${port} is already in use, so ${what} cannot start. ` +
    `Another \`pd dev\` is probably still running: stop it, or start this one on other ports:\n` +
    `  ${advice}`,
  );
}

/** Whether anything accepts a connection on `port` at `host` (refused, unreachable or no answer in time: no). */
function answers(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ port, host });
    const done = (yes: boolean) => { socket.destroy(); resolve(yes); };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Stop before binding when another server already answers on `port`, on IPv4 or IPv6 loopback. pd dev binds
 * 127.0.0.1; a server holding the port on ::1 (or the IPv6 wildcard) doesn't make that bind fail, on macOS at least,
 * and a browser that resolves *.localhost to ::1 would then show the other server's pages. Port 0 (any free port) is
 * never checked. Throws the same PortInUseError a failed bind does.
 */
export async function assertPortFree(port: number, role: "workbench" | "live reload", ports: { http: number; wsChosen: boolean }): Promise<void> {
  if (port === 0) return;
  const taken = (await Promise.all([answers(port, "127.0.0.1"), answers(port, "::1")])).some(Boolean);
  if (taken) throw describeBindError(Object.assign(new Error(`port ${port} answers`), { code: "EADDRINUSE" }), port, role, ports);
}
