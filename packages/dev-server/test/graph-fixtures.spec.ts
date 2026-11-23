// The committed fixtures, together, have every kind the graph knows: each node and edge kind, each role, stylesheet
// source, way a page places a component and way it gets its layout, plus the couplings the graph exists for (a
// component's stylesheet that reaches into another component's class, a template's <style> that does, a package's
// component placed on a site's page). The lists come from the contract (graph.ts), so a kind added there without a
// fixture case fails here: an edge kind no fixture has is an edge no test sees go missing.
//
// Fixtures: test-bench (a style guide with a pattern package), storefront-bench (a site), package-bench (a site on
// two linked pattern packages) and test/fixtures/graph-sources (the stylesheet sources the benches can't carry
// without changing every preview: an assets.css file, an assets.css URL, a template's own <link>).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import {
  COMPONENT_ROLES, GRAPH_EDGE_KINDS, GRAPH_NODE_KINDS, PLACES_HOW, RENDERS_SOURCES, STYLESHEET_SOURCES,
  type ClassNode, type GraphNode, type ProjectGraphJson, type StylesheetNode,
} from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";
import siteBenchConfig from "../../../storefront-bench/pattern-dump.config.js";
import packageBenchConfig from "../../../package-bench/pattern-dump.config.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const servers: DevServer[] = [];
const graphs: ProjectGraphJson[] = [];

const sourcesConfig = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  assets: { dir: "./assets", css: ["css/vendor.css", "https://fonts.example.test/family.css"] },
});

beforeAll(async () => {
  for (const [root, cfg] of [
    [join(repo, "test-bench"), validateConfig(testBenchConfig, "test-bench")],
    [join(repo, "storefront-bench"), validateConfig(siteBenchConfig, "storefront-bench")],
    [join(repo, "package-bench"), validateConfig(packageBenchConfig, "package-bench")],
    [join(repo, "packages/dev-server/test/fixtures/graph-sources"), sourcesConfig],
  ] as const) {
    const server = await startDevServer(cfg, root, { port: 0, wsPort: 0 });
    servers.push(server);
    graphs.push(await (await fetch(`http://127.0.0.1:${server.port}/api/graph`)).json() as ProjectGraphJson);
  }
}, 120_000);
afterAll(async () => { await Promise.all(servers.map(s => s.close())); });

/** Everything the fixtures have, named "<what>:<value>". */
function seen(): Set<string> {
  const out = new Set<string>();
  for (const g of graphs) {
    const nodes = new Map<string, GraphNode>(g.nodes.map(n => [n.id, n]));
    for (const n of g.nodes) {
      out.add(`node:${n.kind}`);
      if (n.kind === "component") out.add(`role:${n.role}`);
      if (n.kind === "stylesheet") out.add(`source:${n.source}`);
    }
    for (const e of g.edges) {
      out.add(`edge:${e.kind}`);
      if (e.kind === "renders") out.add(`renders:${e.source}`);
      if (e.kind === "places") {
        out.add(`places:${e.how}`);
        const to = nodes.get(e.to);
        if (to && "origin" in to && "package" in to.origin) out.add("coupling:a package's component placed on a page");
      }
      if (e.kind === "mentions") {
        const sheet = nodes.get(e.from) as StylesheetNode;
        const cls = nodes.get(e.to) as ClassNode;
        const intoAnother = sheet.component !== null && cls.owner !== null && cls.owner !== "base" && cls.owner !== sheet.component;
        if (intoAnother && sheet.source === "inline") out.add("coupling:a template's <style> styles another component's class");
        if (intoAnother && sheet.source === "scss") out.add("coupling:a stylesheet styles another component's class");
      }
    }
  }
  return out;
}

describe("the committed fixtures have every kind of the graph", () => {
  it.each([
    ...GRAPH_NODE_KINDS.map(k => `node:${k}`),
    ...GRAPH_EDGE_KINDS.map(k => `edge:${k}`),
    ...COMPONENT_ROLES.map(k => `role:${k}`),
    ...STYLESHEET_SOURCES.map(k => `source:${k}`),
    ...PLACES_HOW.map(k => `places:${k}`),
    ...RENDERS_SOURCES.map(k => `renders:${k}`),
    "coupling:a stylesheet styles another component's class",
    "coupling:a template's <style> styles another component's class",
    "coupling:a package's component placed on a page",
  ])("%s", (what) => {
    expect([...seen()]).toContain(what);
  });
});
