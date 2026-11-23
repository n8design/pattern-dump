// pd audit and the workbench find the same: the headless audit (runDiagnosticsAudit, what pd audit prints) and the
// running server's /api/audit give the same findings and the same style couplings, and the project graph built
// without a server (graph/standalone.ts, what pd audit and pd graph read) is the server's, byte for byte.
//
// On test-bench, which has each thing that could make them differ: includes, variants (own markup and data), a
// pattern package's components, project helpers, global data, and stylesheets that style other components' classes.
// "The audit renders as the workbench does" is a promise the docs make (BACKLOG, Architecture).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateConfig } from "@pattern-dump/config";
import type { AuditResponse, AuditStyle, DiagnosticsGraph } from "@pattern-dump/contracts";
import { runDiagnosticsAudit, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { buildProjectGraph } from "../src/graph/standalone.js";
import { graphJson } from "../src/graph/build.js";
import { resolveServerConfig } from "../src/server-config.js";
import { loadPatternPackages } from "../src/packages.js";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = join(repo, "test-bench");
const config = validateConfig(testBenchConfig, "test-bench");

let server: DevServer;
let headless: { graph: DiagnosticsGraph; style: AuditStyle };
let live: AuditResponse;

beforeAll(async () => {
  headless = await runDiagnosticsAudit(config, root);
  server = await startDevServer(config, root, { port: 0, wsPort: 0 });
  live = await (await fetch(`http://127.0.0.1:${server.port}/api/audit`)).json() as AuditResponse;
}, 180_000);
afterAll(async () => { await server?.close(); });

describe("pd audit and the workbench find the same", () => {
  it("the same components, with the same render outcomes", () => {
    expect(live.components).toEqual(headless.graph.components);
  });

  it("the same findings", () => {
    expect(headless.graph.occurrences.length).toBeGreaterThan(0);
    expect(live.occurrences).toEqual(headless.graph.occurrences);
  });

  it("the same style couplings, borrowed classes and stylesheets that style another component's classes", () => {
    expect(headless.style.borrowed.length).toBeGreaterThan(0);
    expect(headless.style.couplings.length).toBeGreaterThan(0);
    expect(live.style).toEqual(headless.style);
  });

  it("the same project graph, built without a server and by it", async () => {
    const cfg = resolveServerConfig(config, root, {}, loadPatternPackages(config.packages, root));
    const standalone = JSON.stringify(graphJson(await buildProjectGraph(cfg, { live: true })));
    expect(standalone).toBe(await (await fetch(`http://127.0.0.1:${server.port}/api/graph`)).text());
  });
});
