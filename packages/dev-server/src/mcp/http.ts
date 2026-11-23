// The MCP server over HTTP, inside pd dev: the Streamable HTTP transport, as much of it as a server of request and
// answer needs. One JSON-RPC message per POST; an answer comes back as JSON, a notification gets 202. No stream (GET
// is 405, which the protocol allows) and no sessions: every call stands alone.
//
// Where it answers: on its own host (config mcp.host, default mcp.localhost) at / and /mcp, and at /mcp on localhost
// and 127.0.0.1 for a client that doesn't resolve *.localhost. Never on the workbench's own name or the site's host:
// the site owns its paths. The Host header is checked before (routes.ts, like every request); here the Origin, as the
// protocol asks of an HTTP server: none (a client that isn't a browser) or a page pd dev served, else 403.

import type { IncomingMessage, ServerResponse } from "node:http";
import { MCP_PROTOCOL_VERSION } from "@pattern-dump/contracts";
import { isOwnOrigin } from "../own-hosts.js";
import { RPC, type McpHandler } from "./server.js";

/** The largest request body read: a tool call is small. */
const MAX_BODY = 1024 * 1024;

/** Whether a request is the MCP server's: its host at / or /mcp, or /mcp on localhost and 127.0.0.1. On the MCP host,
 *  any other path is "elsewhere" (404): the host serves nothing else. */
export function mcpEndpoint(host: string, pathname: string, mcpHost: string): "mcp" | "elsewhere" | null {
  if (host === mcpHost) return pathname === "/" || pathname === "/mcp" ? "mcp" : "elsewhere";
  if ((host === "localhost" || host === "127.0.0.1") && pathname === "/mcp") return "mcp";
  return null;
}

function text(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function handleMcpHttp(
  req: IncomingMessage, res: ServerResponse, handler: McpHandler, own: { hosts: ReadonlySet<string>; port: number },
): Promise<void> {
  const origin = req.headers.origin;
  if (origin !== undefined && !isOwnOrigin(origin, own.hosts, own.port)) {
    text(res, 403, "Forbidden: the MCP server answers no page of another site (Origin)");
    return;
  }
  if (req.method !== "POST") {
    text(res, 405, "Method Not Allowed: the MCP server takes one JSON-RPC message per POST", { Allow: "POST" });
    return;
  }
  const asked = req.headers["mcp-protocol-version"];
  if (typeof asked === "string" && asked !== MCP_PROTOCOL_VERSION) {
    text(res, 400, `Bad Request: this server speaks MCP ${MCP_PROTOCOL_VERSION}, not ${asked}`);
    return;
  }
  const body = await readBody(req);
  if (body === null) { text(res, 413, "Payload Too Large"); return; }
  let message: unknown;
  try { message = JSON.parse(body); } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: "the body is not JSON" } }));
    return;
  }
  const answer = await handler(message);
  if (answer === null) { res.writeHead(202); res.end(); return; }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(answer));
}
