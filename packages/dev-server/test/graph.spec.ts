// The project graph (src/graph/): one typed graph of components, styles and pages, built from what the server
// already holds. Checked over its route (/api/graph) on test-bench (with its pattern package) and storefront-bench
// (a site), against edges written out by hand: one or more of every kind, so a reader that loses a kind fails here.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateConfig } from "@pattern-dump/config";
import { GRAPH_VERSION, type GraphEdge, type ProjectGraphJson } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";
import siteBenchConfig from "../../../storefront-bench/pattern-dump.config.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const servers: DevServer[] = [];
let testBench: ProjectGraphJson;
let siteBench: ProjectGraphJson;
let testBenchPort = 0;

async function graphOf(root: string, cfg: Parameters<typeof startDevServer>[0]): Promise<{ graph: ProjectGraphJson; port: number }> {
  const server = await startDevServer(cfg, root, { port: 0, wsPort: 0 });
  servers.push(server);
  const res = await fetch(`http://127.0.0.1:${server.port}/api/graph`);
  expect(res.status).toBe(200);
  return { graph: await res.json() as ProjectGraphJson, port: server.port };
}

beforeAll(async () => {
  ({ graph: testBench, port: testBenchPort } = await graphOf(join(repo, "test-bench"), validateConfig(testBenchConfig, "test-bench")));
  ({ graph: siteBench } = await graphOf(join(repo, "storefront-bench"), validateConfig(siteBenchConfig, "storefront-bench")));
}, 60_000);
afterAll(async () => { await Promise.all(servers.map(s => s.close())); });

const has = (g: ProjectGraphJson, e: Partial<GraphEdge> & Pick<GraphEdge, "kind" | "from" | "to">): void => {
  expect(g.edges).toContainEqual(expect.objectContaining(e));
};

describe("the project graph of a style guide with a pattern package (test-bench)", () => {
  it("is versioned", () => {
    expect(testBench.version).toBe(GRAPH_VERSION);
  });

  it("has a node for every component, variant and package component discovery found", () => {
    const ids = new Set(testBench.nodes.map(n => n.id));
    for (const id of ["component:atoms/button", "component:molecules/field", "variant:atoms/badge~info", "component:atoms/fixture-chip"]) {
      expect(ids).toContain(id);
    }
    expect(testBench.nodes.find(n => n.id === "component:atoms/fixture-chip")).toMatchObject({ origin: { package: "pd-fixture-ui" } });
    expect(testBench.nodes.find(n => n.id === "component:atoms/button")).toMatchObject({ origin: { project: true }, role: "component" });
  });

  it("has every edge kind of a style guide", () => {
    has(testBench, { kind: "includes", from: "component:molecules/field", to: "component:atoms/input" });
    has(testBench, { kind: "includes", from: "component:atoms/widgets/spinner", to: "variant:atoms/badge~info" });
    has(testBench, { kind: "variant-of", from: "variant:atoms/badge~info", to: "component:atoms/badge" });
    has(testBench, { kind: "styled-by", from: "component:atoms/fixture-chip", to: "stylesheet:pd-fixture-ui/sass/01-atoms/_fixture-chip.scss" });
    has(testBench, { kind: "defines", from: "stylesheet:pd-fixture-ui/sass/01-atoms/_fixture-chip.scss", to: "class:fixture-chip", selector: ".fixture-chip" });
    // A project base rule that reaches into the package's class: the edge the separate graphs had no place for.
    has(testBench, { kind: "mentions", from: "stylesheet:src/styles/00-base/shared-family.scss", to: "class:fixture-chip", selector: ".tb-chip-host .fixture-chip" });
    has(testBench, { kind: "borrows", from: "component:atoms/pkg-class-use", to: "class:fixture-chip" });
    has(testBench, { kind: "imports", from: "component:atoms/button", to: "module:00-base/tokens" });
    has(testBench, { kind: "requires", from: "component:atoms/toggle-demo", to: "asset:script/toggle", key: "requireScript" });
    has(testBench, { kind: "requires", from: "component:atoms/icon", to: "asset:svg/symbols", key: "requireAssets" });
  });

  it("a data variant writes its base's classes, and has no stylesheet of its own", () => {
    // atoms/button~disabled is data over atoms/button's template (button~disabled.json), so it renders the same classes.
    has(testBench, { kind: "borrows", from: "variant:atoms/button~disabled", to: "class:df-button" });
    expect(testBench.edges.filter(e => e.kind === "styled-by" && e.from === "variant:atoms/button~disabled")).toEqual([]);
  });

  it("names a plain .css partial as its component's stylesheet", () => {
    has(testBench, { kind: "styled-by", from: "component:atoms/plain-css", to: "stylesheet:src/styles/01-atoms/_plain-css.css" });
    expect(testBench.nodes.find(n => n.id === "stylesheet:src/styles/01-atoms/_plain-css.css")).toMatchObject({ source: "css", component: "atoms/plain-css" });
  });

  it("gives each class its owner, as the style index claims it", () => {
    expect(testBench.nodes.find(n => n.id === "class:fixture-chip")).toMatchObject({ owner: "atoms/fixture-chip" });
  });

  it("names no absolute path", () => {
    expect(JSON.stringify(testBench)).not.toContain(repo);
  });

  it("is the same bytes when built again", async () => {
    const again = await (await fetch(`http://127.0.0.1:${testBenchPort}/api/graph`)).text();
    expect(again).toBe(JSON.stringify(testBench));
    const { graph } = await graphOf(join(repo, "test-bench"), validateConfig(testBenchConfig, "test-bench"));
    expect(JSON.stringify(graph)).toBe(JSON.stringify(testBench));
  });

  it("lists nodes by id and edges by where they start, their kind and where they end", () => {
    const ids = testBench.nodes.map(n => n.id);
    expect(ids).toEqual([...ids].sort());
    const keys = testBench.edges.map(e => `${e.from}\u0000${e.kind}\u0000${e.to}`);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has no edge to a node it doesn't have", () => {
    const ids = new Set(testBench.nodes.map(n => n.id));
    for (const e of testBench.edges) { expect(ids).toContain(e.from); expect(ids).toContain(e.to); }
  });
});

describe("the project graph of a site (storefront-bench)", () => {
  it("has a node for every page, generated ones too", () => {
    expect(siteBench.nodes).toContainEqual({ id: "page:/about/", kind: "page", route: "/about/", file: "about.md" });
    expect(siteBench.nodes).toContainEqual(expect.objectContaining({ id: "page:/categories/", generated: "categories" }));
  });

  it("names how each page got its layout", () => {
    has(siteBench, { kind: "renders", from: "page:/articles/harbour/", to: "component:layouts/article", source: "folder", via: "articles/index.md" });
    has(siteBench, { kind: "renders", from: "page:/categories/", to: "component:layouts/categories", source: "generated" });
    expect(siteBench.nodes.find(n => n.id === "component:layouts/article")).toMatchObject({ role: "layout" });
    expect(siteBench.nodes.find(n => n.id === "component:views/compact")).toMatchObject({ role: "view" });
  });

  it("has what each page places: a pd- tag, a child tag, a pattern fence and its listing's card", () => {
    has(siteBench, { kind: "places", from: "page:/about/", to: "component:components/icon-label", how: "tag" });
    has(siteBench, { kind: "places", from: "page:/guides/", to: "component:components/slider", how: "tag" });
    has(siteBench, { kind: "places", from: "page:/guides/", to: "component:components/slide", how: "tag" });
    has(siteBench, { kind: "places", from: "page:/", to: "component:components/callout", how: "pattern" });
    has(siteBench, { kind: "places", from: "page:/articles/", to: "component:components/card", how: "card" });
  });

  it("has what a page's queries place: the query's view and the view's card, on a generated page too", () => {
    // layouts/article declares page.related with view "compact"; views/compact's entries name components/compact-card.
    has(siteBench, { kind: "places", from: "page:/articles/harbour/", to: "component:views/compact", how: "view" });
    has(siteBench, { kind: "places", from: "page:/articles/harbour/", to: "component:components/compact-card", how: "card" });
    // layouts/tag's page.pages query, with the layout's defaults: a generated page has no frontmatter.
    has(siteBench, { kind: "places", from: "page:/tags/design/", to: "component:components/compact-card", how: "card" });
  });
});
