// The MCP SDK's client, for the specs: over HTTP to a pd dev on 127.0.0.1 with a Host header of choice (a name such
// as mcp.localhost need not resolve: CI's and Node's resolvers differ), and over stdio to `pd mcp`.
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** A fetch that sends every request to 127.0.0.1:`port`, with `host` as its Host header (and `origin`, if given). */
export function loopbackFetch(port: number, host: string, origin?: string): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = init?.body === undefined || init.body === null ? undefined : String(init.body);
    return new Promise<Response>((resolve, reject) => {
      const req = request({
        host: "127.0.0.1", port, path: url.pathname + url.search, method: init?.method ?? "GET",
        headers: { ...Object.fromEntries(headers), host: `${host}:${port}`, ...(origin ? { origin } : {}) },
      }, res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") h.set(k, v);
          const status = res.statusCode ?? 0;
          resolve(new Response(status === 202 || status === 204 ? null : Buffer.concat(chunks), { status, headers: h }));
        });
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }) as typeof fetch;
}

/** A connected client over HTTP: `path` on `host` at `port`. */
export async function httpClient(port: number, host = "mcp.localhost", path = "/"): Promise<Client> {
  const client = new Client({ name: "pd-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://${host}:${port}${path}`), { fetch: loopbackFetch(port, host) }));
  return client;
}

const cli = fileURLToPath(new URL("../../cli/dist/index.js", import.meta.url));

/** A connected client over stdio to `pd mcp --root <root>` (and `--config`, for a copy whose config can't resolve its
 *  imports where it lies), as a client that starts a process does. */
export async function stdioClient(root: string, config?: string): Promise<Client> {
  const client = new Client({ name: "pd-test", version: "0.0.0" });
  const args = [cli, "mcp", "--root", root, ...(config ? ["--config", config] : [])];
  await client.connect(new StdioClientTransport({ command: process.execPath, args, stderr: "ignore" }));
  return client;
}

/** A tool's answer: its structured content (the JSON the command line prints), or its error text. */
export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ answer?: unknown; error?: string }> {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) return { error: (r.content as Array<{ text: string }>)[0]!.text };
  return { answer: r.structuredContent };
}
