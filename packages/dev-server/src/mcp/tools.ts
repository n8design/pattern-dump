// The MCP server's tools: read-only questions about the project, each answered from the project graph with the same
// JSON as the command line (graph/answers.ts). A tool reads its project through an McpSource: pd dev's caches in pd dev,
// the same server's in pd mcp. Nothing here writes a file or starts an audit.

import { isAbsolute, resolve } from "node:path";
import {
  COMPONENT_ROLES, GRAPH_VERSION, buildAuditRollup,
  type ChecksAnswer, type ComponentTree, type ComponentsAnswer, type ComponentNode, type DiagnosticsGraph, type DiscoveryMap,
  type McpToolName, type TreeNode,
} from "@pattern-dump/contracts";
import type { ProjectGraph } from "../graph/build.js";
import { affectedOf, blastRadiusOf, contractOf, ownershipOf, usageOf } from "../graph/answers.js";

/** What a tool reads: the project as the server holds it now. */
export interface McpSource {
  graph(): Promise<ProjectGraph>;
  discoveryMap(): Promise<DiscoveryMap>;
  tree(): Promise<ComponentTree>;
  /** The latest audit results, with where they come from, or null when there are none. Never starts an audit. */
  audit(): Promise<{ graph: DiagnosticsGraph; from: "workbench" | "last audit" } | null>;
  /** The project's root: a file a tool is given is resolved against it. */
  root: string;
  /** The pages folder, root-relative with a trailing slash, when there is a site. */
  pagesPrefix?: string;
  /** How the graph names a file (display-path.ts). */
  display(absPath: string): string;
}

/** A tool as `tools/list` describes it. */
export interface McpToolDefinition {
  name: McpToolName;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  annotations: { readOnlyHint: true; openWorldHint: false };
}

/** Thrown for arguments a tool can't take: answered as JSON-RPC's invalid params. */
export class McpParamsError extends Error {
  constructor(message: string) { super(message); this.name = "McpParamsError"; }
}

const ID = { type: "string", description: "A component's id, such as atoms/button, or a variant's, such as atoms/button~icon" } as const;
const read = { readOnlyHint: true, openWorldHint: false } as const;

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "components", title: "Components",
    description: "List the project's components: each id, its role (component, layout, partial or view), where it comes from (the project or a pattern package), its variants, and whether the workbench hides it.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        role: { type: "string", enum: [...COMPONENT_ROLES], description: "Only components of this role" },
        origin: { type: "string", description: "Only the project's (\"project\") or one pattern package's (its npm name)" },
      },
    },
    annotations: read,
  },
  {
    name: "contract", title: "Contract",
    description: "What a component accepts: its JSON Schema as written, its variants, and its documentation.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: ID }, required: ["id"] },
    annotations: read,
  },
  {
    name: "usage", title: "Usage",
    description: "Where a component appears: the components that include it, and every page that places it or renders with it, directly or through a component that includes it.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: ID }, required: ["id"] },
    annotations: read,
  },
  {
    name: "blast_radius", title: "Blast radius",
    description: "What breaks if a component changes: the components, stylesheets and pages it reaches, each with the path of edges that connects it. Ask before changing a component.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: ID }, required: ["id"] },
    annotations: read,
  },
  {
    name: "ownership", title: "Ownership",
    description: "Which stylesheets style a component: its own, the classes it defines, the modules it loads, the classes of other components it styles and that others style of its, and the classes its template borrows.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: ID }, required: ["id"] },
    annotations: read,
  },
  {
    name: "affected", title: "Affected",
    description: "Everything a change reaches, as one flat list of components and pages to check before handing over. Takes changed component ids, changed files (relative to the project's root), or both.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        ids: { type: "array", items: ID, description: "Changed components" },
        files: { type: "array", items: { type: "string" }, description: "Changed files, relative to the project's root, such as src/styles/atoms/button.scss" },
      },
    },
    annotations: read,
  },
  {
    name: "checks", title: "Checks",
    description: "The latest audit results (markup, accessibility, schema): for one component its findings, or the project's summary. Reads results that exist; it never runs an audit.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { ...ID, description: "One component; without it, the whole project" } } },
    annotations: read,
  },
];

/** A string argument, or McpParamsError. */
function stringArg(args: Record<string, unknown>, key: string, required: true): string;
function stringArg(args: Record<string, unknown>, key: string, required: false): string | undefined;
function stringArg(args: Record<string, unknown>, key: string, required: boolean): string | undefined {
  const v = args[key];
  if (v === undefined && !required) return undefined;
  if (typeof v !== "string" || v === "") throw new McpParamsError(`"${key}" must be a non-empty string`);
  return v;
}

function stringsArg(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some(x => typeof x !== "string")) throw new McpParamsError(`"${key}" must be a list of strings`);
  return v as string[];
}

/** Every component id the workbench hides: one marked private, and everything in a private folder. */
function privateIds(tree: ComponentTree): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: TreeNode[], hidden: boolean): void => {
    for (const n of nodes) {
      const h = hidden || n.visibility === "private";
      if (n.kind === "component" && h) out.add(n.path);
      walk(n.children ?? [], h);
    }
  };
  walk(tree.roots, false);
  return out;
}

/** Answer tool `name` with `args`. An unknown id throws UnknownIdError, wrong arguments McpParamsError. */
export async function callTool(name: string, args: Record<string, unknown>, source: McpSource): Promise<unknown> {
  const unknownKeys = (allowed: string[]): void => {
    const extra = Object.keys(args).filter(k => !allowed.includes(k));
    if (extra.length) throw new McpParamsError(`unknown argument${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}`);
  };
  switch (name) {
    case "components": {
      unknownKeys(["role", "origin"]);
      const role = stringArg(args, "role", false);
      const origin = stringArg(args, "origin", false);
      if (role !== undefined && !(COMPONENT_ROLES as readonly string[]).includes(role)) throw new McpParamsError(`"role" must be one of ${COMPONENT_ROLES.join(", ")}`);
      const [graph, tree] = await Promise.all([source.graph(), source.tree()]);
      const hidden = privateIds(tree);
      const variants = new Map<string, string[]>();
      for (const n of graph.nodes.values()) if (n.kind === "variant") variants.set(n.of, [...variants.get(n.of) ?? [], n.id.slice("variant:".length)]);
      const components = [...graph.nodes.values()].filter((n): n is ComponentNode => n.kind === "component")
        .filter(n => role === undefined || n.role === role)
        .filter(n => origin === undefined || (origin === "project" ? "project" in n.origin : "package" in n.origin && n.origin.package === origin))
        .map(n => {
          const id = n.id.slice("component:".length);
          return { id, role: n.role, origin: n.origin, variants: (variants.get(id) ?? []).sort(), private: hidden.has(id) };
        });
      return { version: GRAPH_VERSION, components } satisfies ComponentsAnswer;
    }
    case "contract":
      unknownKeys(["id"]);
      return contractOf(await source.graph(), stringArg(args, "id", true), await source.discoveryMap());
    case "usage":
      unknownKeys(["id"]);
      return usageOf(await source.graph(), stringArg(args, "id", true));
    case "blast_radius":
      unknownKeys(["id"]);
      return blastRadiusOf(await source.graph(), stringArg(args, "id", true));
    case "ownership":
      unknownKeys(["id"]);
      return ownershipOf(await source.graph(), stringArg(args, "id", true));
    case "affected": {
      unknownKeys(["ids", "files"]);
      const ids = stringsArg(args, "ids");
      // A file is the project's (root-relative, or absolute inside it), named as the graph names files.
      const files = stringsArg(args, "files").map(f => source.display(isAbsolute(f) ? f : resolve(source.root, f)));
      if (!ids.length && !files.length) throw new McpParamsError(`give "ids", "files", or both`);
      return affectedOf(await source.graph(), { ids, files }, source.pagesPrefix);
    }
    case "checks": {
      unknownKeys(["id"]);
      const id = stringArg(args, "id", false);
      const latest = await source.audit();
      if (id !== undefined) {
        const graph = await source.graph();
        if (!graph.nodes.has(`component:${id}`) && !graph.nodes.has(`variant:${id}`)) {
          // The same error, with the nearest ids, as every tool that takes an id.
          await contractOf(graph, id, await source.discoveryMap());
        }
      }
      if (!latest) {
        return { version: GRAPH_VERSION, from: null, ...(id !== undefined ? { id } : {}),
          note: "No audit results yet: run pd audit, or open the workbench's Audit tab, then ask again." } satisfies ChecksAnswer;
      }
      if (id === undefined) {
        const { headline, totals, rulesByBlast } = buildAuditRollup(latest.graph);
        return { version: GRAPH_VERSION, from: latest.from, summary: { headline, totals, rulesByBlast } } satisfies ChecksAnswer;
      }
      const node = latest.graph.components.find(c => c.id === id);
      const findings = latest.graph.occurrences.filter(o => o.component === id)
        .map(({ engine, ruleId, severity, message }) => ({ engine, ruleId, severity, message }));
      return { version: GRAPH_VERSION, from: latest.from, id, ...(node ? { render: node.render } : {}), findings } satisfies ChecksAnswer;
    }
    default:
      throw new McpParamsError(`there is no tool "${name}": the tools are ${MCP_TOOLS.map(t => t.name).join(", ")}`);
  }
}
