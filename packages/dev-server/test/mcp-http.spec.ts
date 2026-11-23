// The MCP server inside pd dev, through the MCP SDK's own client (the reference implementation: a server that drifts
// from the protocol fails here, on every CI run). Each tool answers the same JSON as the command line's function; the
// server is reached on its host and on the /mcp fallback, and nowhere else; a foreign Host or Origin is refused.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { connect } from "node:net";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { MCP_PROTOCOL_VERSION, MCP_TOOL_NAMES } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { readProjectGraph, type ProjectGraphRead } from "../src/graph/project.js";
import { affectedOf, blastRadiusOf, contractOf, ownershipOf, usageOf } from "../src/graph/answers.js";
import { call, httpClient } from "./mcp-client.js";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = join(repo, "test-bench");
const config = validateConfig(testBenchConfig, "test-bench");
let server: DevServer;
let client: Client;
let read: ProjectGraphRead;

beforeAll(async () => {
  server = await startDevServer(config, root, { port: 0, wsPort: 0, version: "9.9.9-test" });
  client = await httpClient(server.port);
  read = await readProjectGraph(config, root);
}, 60_000);
afterAll(async () => { await client?.close(); await server?.close(); });

/** A raw request to the server: method, path, Host, and the headers given. */
function raw(o: { method?: string; path?: string; host: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string; type?: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, method: o.method ?? "POST", path: o.path ?? "/",
      headers: { host: o.host, "content-type": "application/json", accept: "application/json, text/event-stream", ...o.headers } }, res => {
      let body = "";
      res.setEncoding("utf8").on("data", c => { body += c; }).on("end", () => resolve({ status: res.statusCode ?? 0, body, ...(res.headers["content-type"] ? { type: res.headers["content-type"] } : {}) }));
    });
    req.on("error", reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}
const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });

describe("the MCP server's protocol", () => {
  it("speaks the pinned protocol revision, and names itself", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2025-11-25");
    expect(client.getServerVersion()).toMatchObject({ name: "pattern-dump", version: "9.9.9-test" });
  });

  it("lists its tools, read-only, by the names of the contract", async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toEqual([...MCP_TOOL_NAMES]);
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("refuses a request that names another protocol revision", async () => {
    const r = await raw({ host: `mcp.localhost:${server.port}`, headers: { "mcp-protocol-version": "2024-11-05" }, body: ping });
    expect(r.status).toBe(400);
  });

  it("answers a notification with 202 and nothing, and a GET with 405", async () => {
    const n = await raw({ host: `mcp.localhost:${server.port}`, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(n).toMatchObject({ status: 202, body: "" });
    expect((await raw({ method: "GET", host: `mcp.localhost:${server.port}` })).status).toBe(405);
  });
});

describe("each tool answers what the command line answers", () => {
  it("contract, usage, blast_radius, ownership", async () => {
    expect((await call(client, "contract", { id: "atoms/button" })).answer).toEqual(await contractOf(read.graph, "atoms/button", read.discoveryMap));
    expect((await call(client, "usage", { id: "atoms/button" })).answer).toEqual(usageOf(read.graph, "atoms/button"));
    expect((await call(client, "blast_radius", { id: "atoms/button" })).answer).toEqual(blastRadiusOf(read.graph, "atoms/button"));
    expect((await call(client, "ownership", { id: "molecules/coupled" })).answer).toEqual(ownershipOf(read.graph, "molecules/coupled"));
  });

  it("affected, with files relative to the root", async () => {
    const args = { ids: ["molecules/field"], files: ["src/styles/00-base/_tokens.scss"] };
    expect((await call(client, "affected", args)).answer).toEqual(affectedOf(read.graph, args, read.pagesPrefix));
  });

  it("components, with roles, origins, variants and the private ones", async () => {
    const { answer } = await call(client, "components", {});
    const list = (answer as { components: Array<{ id: string; origin: unknown; variants: string[]; private: boolean }> }).components;
    expect(list.find(c => c.id === "atoms/button")).toMatchObject({ origin: { project: true }, variants: ["atoms/button~disabled", "atoms/button~secondary"], private: false });
    const pkg = (await call(client, "components", { origin: "pd-fixture-ui" })).answer as { components: Array<{ id: string }> };
    expect(pkg.components.map(c => c.id)).toContain("atoms/fixture-chip");
    expect(pkg.components.every(c => c.id !== "atoms/button")).toBe(true);
  });

  it("an unknown id is the tool's error, with the nearest id; a wrong argument is invalid params", async () => {
    expect((await call(client, "usage", { id: "atoms/buton" })).error).toContain(`did you mean "atoms/button"`);
    await expect(client.callTool({ name: "usage", arguments: {} })).rejects.toThrow(/"id" must be a non-empty string/);
    await expect(client.callTool({ name: "usage", arguments: { id: "atoms/button", extra: 1 } })).rejects.toThrow(/unknown argument/);
  });
});

describe("checks reads results that exist, and never runs an audit", () => {
  it("none yet, then the workbench's once it has audited", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pd-mcp-checks-"));
    try {
      await save(join(dir, "src/patterns/atoms/plain/plain.hbs"), `<img src="x.png">\n`);
      const s = await startDevServer(defineConfig({ sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" } }), dir, { port: 0, wsPort: 0 });
      const c = await httpClient(s.port);
      try {
        expect((await call(c, "checks", {})).answer).toMatchObject({ from: null });
        await (await fetch(`http://127.0.0.1:${s.port}/api/audit`)).text();
        const one = (await call(c, "checks", { id: "atoms/plain" })).answer as { from: string; findings: Array<{ ruleId: string }> };
        expect(one.from).toBe("workbench");
        expect(one.findings.length).toBeGreaterThan(0);
      } finally { await c.close(); await s.close(); }
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60_000);
});

describe("where the MCP server answers, and to whom", () => {
  it("on its host at / and /mcp, and at /mcp on localhost and 127.0.0.1", async () => {
    for (const [host, path] of [["mcp.localhost", "/"], ["mcp.localhost", "/mcp"], ["localhost", "/mcp"], ["127.0.0.1", "/mcp"]] as const) {
      const r = await raw({ host: `${host}:${server.port}`, path, body: ping });
      expect(r, `${host}${path}`).toMatchObject({ status: 200, type: "application/json" });
      expect(JSON.parse(r.body)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    }
  });

  it("not on the workbench's own name, and the MCP host serves nothing else", async () => {
    const wb = await raw({ host: `pd.localhost:${server.port}`, path: "/mcp", body: ping });
    expect(wb.body).not.toContain(`"jsonrpc"`);
    expect((await raw({ method: "GET", host: `mcp.localhost:${server.port}`, path: "/api/tree" })).status).toBe(404);
  });

  it("refuses a foreign Host", async () => {
    expect((await raw({ host: `evil.example:${server.port}`, body: ping })).status).toBe(403);
    expect((await raw({ host: `mcp.localhost.com:${server.port}`, body: ping })).status).toBe(403);
  });

  it("refuses a foreign Origin, and takes none or its own", async () => {
    expect((await raw({ host: `mcp.localhost:${server.port}`, headers: { origin: "https://evil.example" }, body: ping })).status).toBe(403);
    expect((await raw({ host: `mcp.localhost:${server.port}`, headers: { origin: `http://evil.localhost:${server.port}` }, body: ping })).status).toBe(403);
    expect((await raw({ host: `mcp.localhost:${server.port}`, headers: { origin: `http://pd.localhost:${server.port}` }, body: ping })).status).toBe(200);
    expect((await raw({ host: `mcp.localhost:${server.port}`, body: ping })).status).toBe(200);
  });

  // A machine without a non-loopback IPv4 address (a bare container) has no other door to try.
  const outside = Object.values(networkInterfaces()).flat().find(i => i && i.family === "IPv4" && !i.internal)?.address;
  it.skipIf(outside === undefined)("listens on loopback only: the machine's other address is refused", async () => {
    const outcome = await new Promise<string>(resolve => {
      const socket = connect({ host: outside!, port: server.port });
      socket.setTimeout(3000, () => { socket.destroy(); resolve("timeout"); });
      socket.on("connect", () => { socket.destroy(); resolve("connected"); });
      socket.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
    });
    expect(outcome).not.toBe("connected");
  });
});

describe("a configured mcp.host", () => {
  it("answers on that name, and mcp.localhost is then no host of the server's", async () => {
    const s = await startDevServer(validateConfig({ ...testBenchConfig, mcp: { host: "tools.localhost" } }, "test-bench"), root, { port: 0, wsPort: 0 });
    try {
      const own = await new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: s.port, method: "POST", path: "/", headers: { host: `tools.localhost:${s.port}`, "content-type": "application/json" } },
          res => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on("error", reject); req.end(ping);
      });
      expect(own).toBe(200);
      const old = await new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: s.port, method: "POST", path: "/", headers: { host: `mcp.localhost:${s.port}`, "content-type": "application/json" } },
          res => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on("error", reject); req.end(ping);
      });
      expect(old).toBe(403);
    } finally { await s.close(); }
  }, 60_000);
});
