// The MCP server's messages: JSON-RPC 2.0, the part of the protocol a read-only tool server needs (initialize, ping,
// tools/list, tools/call), the same for the HTTP transport (http.ts) and stdio (pd mcp). One message in, one answer
// out, or null for a notification. The protocol revision is pinned (MCP_PROTOCOL_VERSION).

import { MCP_PROTOCOL_VERSION, MCP_SERVER_NAME } from "@pattern-dump/contracts";
import { UnknownIdError } from "../graph/answers.js";
import { callTool, McpParamsError, MCP_TOOLS, type McpSource } from "./tools.js";

type JsonRpcId = string | number;
type Answer = { jsonrpc: "2.0"; id: JsonRpcId | null } & ({ result: unknown } | { error: { code: number; message: string } });

/** JSON-RPC's error codes. */
export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

const INSTRUCTIONS = "Answers about this Pattern Dump project, read from its graph of components, stylesheets and pages, "
  + "current after every save. Before changing a component, ask blast_radius; before handing work over, ask affected "
  + "for the components and pages to check. Component ids are the workbench's, such as atoms/button.";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const error = (id: JsonRpcId | null, code: number, message: string): Answer => ({ jsonrpc: "2.0", id, error: { code, message } });

/** The answer to one message, or null when it needs none (a notification, or a client's response). */
export type McpHandler = (message: unknown) => Promise<Answer | null>;

/** `source`: what a tool call reads, made once per call, so one call reads one state of the project. */
export function createMcpHandler(source: () => McpSource, version: string): McpHandler {
  return async (message) => {
    if (Array.isArray(message)) return error(null, RPC.invalidRequest, "batches are not supported: send one message at a time");
    if (!isObject(message) || message["jsonrpc"] !== "2.0") return error(null, RPC.invalidRequest, "not a JSON-RPC 2.0 message");
    const method = message["method"];
    const id = message["id"];
    // A response to a request of ours: the server makes none, so there is nothing to answer.
    if (method === undefined) return null;
    if (typeof method !== "string") return error(null, RPC.invalidRequest, "a message's method is a string");
    // A notification (no id): nothing to answer, whatever it is (notifications/initialized, cancellations).
    if (id === undefined) return null;
    if (typeof id !== "string" && typeof id !== "number") return error(null, RPC.invalidRequest, "a request's id is a string or a number");
    const params = isObject(message["params"]) ? message["params"] : {};
    const ok = (result: unknown): Answer => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize":
        return ok({
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, title: "Pattern Dump", version },
          instructions: INSTRUCTIONS,
        });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: MCP_TOOLS });
      case "tools/call": {
        const name = params["name"];
        if (typeof name !== "string") return error(id, RPC.invalidParams, "tools/call needs the tool's name");
        const args = params["arguments"] === undefined ? {} : params["arguments"];
        if (!isObject(args)) return error(id, RPC.invalidParams, "a tool's arguments are an object");
        try {
          const answer = await callTool(name, args, source());
          return ok({ content: [{ type: "text", text: JSON.stringify(answer, null, 2) }], structuredContent: answer });
        } catch (e) {
          if (e instanceof McpParamsError) return error(id, RPC.invalidParams, e.message);
          // An id the project doesn't have is the tool's answer, as an error the model reads (with the nearest ids).
          if (e instanceof UnknownIdError) return ok({ content: [{ type: "text", text: e.message }], isError: true });
          return error(id, RPC.internal, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return error(id, RPC.methodNotFound, `the server has no method "${method}"`);
    }
  };
}
