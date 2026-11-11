// The host names pd dev answers to: the workbench's (localhost, 127.0.0.1, pd.localhost) and, with a
// storefront, storefront.host. A browser page on any other site must not reach pd dev: not its HTTP routes
// (a name that only resolves to 127.0.0.1, as in DNS rebinding, still carries its own name in Host), and
// not its live-reload socket (a browser always sends the page's Origin with the handshake).

import { PD_HOSTS } from "@pattern-dump/contracts";

/** The names pd dev answers to, from its config: the workbench's, and storefront.host when there is a storefront. */
export function ownHosts(storefrontHost: string | undefined): ReadonlySet<string> {
  return new Set(["localhost", "127.0.0.1", PD_HOSTS.workbench, ...(storefrontHost ? [storefrontHost] : [])]);
}

/** Whether a Host header names pd dev itself: one of `hosts`, at `port` (no port only for port 80). */
export function isOwnHost(header: string | undefined, hosts: ReadonlySet<string>, port: number): boolean {
  if (!header) return false;
  const m = /^([a-z0-9.-]+)(?::(\d+))?$/i.exec(header.trim());
  if (!m) return false;
  const named = m[2] === undefined ? 80 : Number(m[2]);
  return hosts.has(m[1]!.toLowerCase()) && named === port;
}

/** Whether a browser Origin is a page pd dev served: http, one of `hosts`, at `port`. */
export function isOwnOrigin(origin: string, hosts: ReadonlySet<string>, port: number): boolean {
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== "http:" || url.pathname !== "/" || url.username || url.password) return false;
  return isOwnHost(url.host, hosts, port);
}
