// The MCP server's contract: the protocol version it speaks, its tools by name, and the answers of the two tools that
// have no command-line twin elsewhere (components, checks). The other tools' answers are graph.ts's.

import type { ComponentRole, GraphOrigin, GRAPH_VERSION } from "./graph";
import type { AuditRollup, DiagnosticOccurrence, RenderOutcome } from "./dev-protocol";

/**
 * The one MCP protocol revision the server speaks, pinned: it answers `initialize` with it whatever a client asks
 * for, and a request whose `MCP-Protocol-Version` header names another is refused. Named in the docs; changed only
 * with a release note.
 */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

/** The server's name in `initialize`, as a client shows it. */
export const MCP_SERVER_NAME = "pattern-dump";

/** The tools, by name: words from the docs (contract, usage, ownership, blast radius), and affected. Part of 1.0's
 *  stable surface. */
export const MCP_TOOL_NAMES = ["components", "contract", "usage", "blast_radius", "ownership", "affected", "checks"] as const;
export type McpToolName = typeof MCP_TOOL_NAMES[number];

/** `components`: every component, with what it is, where it comes from, its variants, and whether the workbench hides
 *  it (private). */
export interface ComponentsAnswer {
  version: typeof GRAPH_VERSION;
  components: Array<{ id: string; role: ComponentRole; origin: GraphOrigin; variants: string[]; private: boolean }>;
}

/**
 * `checks`: the latest results of the corpus audit, never a new audit run by the tool. `from`: "workbench" when the
 * running pd dev has audited (its Audit tab, or /api/audit), "last audit" for the results a pd audit or an earlier
 * pd dev saved, null when there are none (then `note` says how to get them). For one component, its findings; for the
 * project, the audit's summary and its rules.
 */
export interface ChecksAnswer {
  version: typeof GRAPH_VERSION;
  from: "workbench" | "last audit" | null;
  note?: string;
  id?: string;
  render?: RenderOutcome;
  findings?: Array<Pick<DiagnosticOccurrence, "engine" | "ruleId" | "severity" | "message">>;
  summary?: Pick<AuditRollup, "headline" | "totals" | "rulesByBlast">;
}
