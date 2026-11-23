// `pd mcp`: the MCP server over stdio, as a client that starts a process (an .mcp.json, the Claude desktop app) runs
// it: the built CLI, through the MCP SDK's stdio client. The same tools and the same answers as the HTTP server, and
// nothing but the protocol on stdout (the SDK's client fails on any other line).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateConfig } from "@pattern-dump/config";
import { MCP_TOOL_NAMES } from "@pattern-dump/contracts";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { readProjectGraph, type ProjectGraphRead } from "../src/graph/project.js";
import { blastRadiusOf, ownershipOf, usageOf } from "../src/graph/answers.js";
import { call, stdioClient } from "./mcp-client.js";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";

const root = join(fileURLToPath(new URL("../../../", import.meta.url)), "test-bench");
let client: Client;
let read: ProjectGraphRead;

beforeAll(async () => {
  client = await stdioClient(root);
  read = await readProjectGraph(validateConfig(testBenchConfig, "test-bench"), root);
}, 60_000);
afterAll(async () => { await client?.close(); });

describe("pd mcp over stdio", () => {
  it("names itself and lists the same tools", async () => {
    expect(client.getServerVersion()?.name).toBe("pattern-dump");
    expect((await client.listTools()).tools.map(t => t.name)).toEqual([...MCP_TOOL_NAMES]);
  });

  it("answers as the command line does", async () => {
    expect((await call(client, "usage", { id: "atoms/button" })).answer).toEqual(usageOf(read.graph, "atoms/button"));
    expect((await call(client, "blast_radius", { id: "atoms/button" })).answer).toEqual(blastRadiusOf(read.graph, "atoms/button"));
    expect((await call(client, "ownership", { id: "molecules/coupled" })).answer).toEqual(ownershipOf(read.graph, "molecules/coupled"));
    expect((await call(client, "usage", { id: "atoms/buton" })).error).toContain(`did you mean "atoms/button"`);
  });
});
