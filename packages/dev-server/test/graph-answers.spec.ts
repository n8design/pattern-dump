// The answers pd describe, pd affected and the MCP tools give (src/graph/answers.ts), on the committed fixtures:
// contract, usage, ownership, blast radius and affected, against values written out by hand. package-bench is the
// site on pattern packages, where usage crosses from the site's pages into a package.
import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateConfig } from "@pattern-dump/config";
import type { GraphEdge, GraphNode } from "@pattern-dump/contracts";
import type { ProjectGraphRead } from "../src/graph/project.js";
import { readProjectGraph } from "../src/graph/project.js";
import { affectedOf, blastRadiusOf, contractOf, describeOf, ownershipOf, UnknownIdError, usageOf } from "../src/graph/answers.js";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";
import siteBenchConfig from "../../../storefront-bench/pattern-dump.config.js";
import packageBenchConfig from "../../../package-bench/pattern-dump.config.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let tb: ProjectGraphRead;
let sb: ProjectGraphRead;
let pb: ProjectGraphRead;

beforeAll(async () => {
  tb = await readProjectGraph(validateConfig(testBenchConfig, "test-bench"), join(repo, "test-bench"));
  sb = await readProjectGraph(validateConfig(siteBenchConfig, "storefront-bench"), join(repo, "storefront-bench"));
  pb = await readProjectGraph(validateConfig(packageBenchConfig, "package-bench"), join(repo, "package-bench"));
}, 120_000);

describe("contract", () => {
  it("is the schema as written, the variants and the docs", async () => {
    const c = await contractOf(tb.graph, "atoms/button", tb.discoveryMap);
    expect(c).toMatchObject({ version: 1, id: "atoms/button", role: "component", origin: { project: true }, file: "src/patterns/atoms/button/button.hbs" });
    expect(c.schema).toMatchObject({ properties: expect.objectContaining({ label: expect.anything() }) });
    expect(c.variants).toEqual([{ id: "atoms/button~disabled", form: "data" }, { id: "atoms/button~secondary", form: "data" }]);
    expect(c.docs).toContain("clickable");
  });

  it("an unknown id is an error naming the nearest", async () => {
    await expect(contractOf(tb.graph, "atoms/buton", tb.discoveryMap)).rejects.toThrow(UnknownIdError);
    await expect(contractOf(tb.graph, "atoms/buton", tb.discoveryMap)).rejects.toThrow(/did you mean "atoms\/button"/);
  });
});

describe("usage", () => {
  it("the components that include it, and the pages that place it, directly or through what includes it", () => {
    const u = usageOf(sb.graph, "components/icon-label");
    expect(u.pages).toContainEqual({ route: "/about/", how: "tag" });
    const card = usageOf(sb.graph, "components/compact-card");
    expect(card.components).toEqual(["views/compact"]);
    expect(card.pages).toContainEqual({ route: "/articles/harbour/", how: "card" });
    expect(card.pages).toContainEqual({ route: "/articles/harbour/", how: "view", through: "views/compact" });
  });

  it("crosses from a site's pages into the package its components come from", () => {
    const u = usageOf(pb.graph, "molecules/card");
    expect(u.pages).toContainEqual({ route: "/", how: "pattern" });
    expect(pb.graph.nodes.get("component:molecules/card")).toMatchObject({ origin: { package: "pd-fixture-ds" } });
  });
});

describe("ownership", () => {
  it("its stylesheets, its classes, and the classes it shares both ways", () => {
    const o = ownershipOf(tb.graph, "molecules/coupled");
    expect(o.stylesheets.map(s => s.source)).toEqual(["inline", "scss"]);
    expect(o.defines).toEqual(["tb-coupled", "tb-coupled-note"]);
    expect(o.stylesClassesOf.map(c => c.component)).toEqual(["atoms/button", "atoms/button"]);
    expect(ownershipOf(tb.graph, "atoms/button").classesStyledBy.map(c => c.component)).toContain("molecules/coupled");
    expect(ownershipOf(tb.graph, "organisms/toolbar").borrows).toContainEqual({ owner: "atoms/button", classes: ["df-button", "df-button--ghost", "df-button--primary"] });
  });
});

describe("blast radius", () => {
  it("reaches what includes it, its variants, and the stylesheets that style its classes, each by its path", () => {
    const r = blastRadiusOf(tb.graph, "atoms/button");
    const ids = r.components.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(["organisms/buttonbar", "atoms/button~disabled", "molecules/coupled", "organisms/toolbar"]));
    expect(r.components.find(c => c.id === "organisms/buttonbar")!.path)
      .toEqual([{ from: "component:organisms/buttonbar", kind: "includes", to: "component:atoms/button" }]);
    // The toolbar writes Button's classes without including it.
    expect(r.components.find(c => c.id === "organisms/toolbar")!.path)
      .toEqual([{ from: "component:organisms/toolbar", kind: "borrows", to: "class:df-button" }]);
    expect(r.stylesheets.map(s => s.file)).toEqual(["src/patterns/molecules/coupled/coupled.hbs", "src/styles/02-molecules/coupled.scss"]);
    expect(r.stylesheets.find(s => s.file.endsWith("coupled.scss"))!.path)
      .toEqual([{ from: "stylesheet:src/styles/02-molecules/coupled.scss", kind: "mentions", to: "class:df-button" }]);
  });

  it("ends at the pages that place anything it reaches", () => {
    const r = blastRadiusOf(sb.graph, "components/compact-card");
    expect(r.pages.map(p => p.route)).toEqual(expect.arrayContaining(["/articles/harbour/", "/tags/design/"]));
  });

  it("follows class couplings from the changed component's own classes only, not from what includes it", () => {
    // header is included by frame; header's stylesheet names frame's class .site in context. A change to the header
    // changes its own classes, not frame's: header.scss is no part of its own blast radius.
    const nodes: Array<[string, GraphNode]> = [
      ["component:header", { id: "component:header", kind: "component", role: "component", origin: { project: true }, file: "header.hbs", schema: null, docs: null }],
      ["component:frame", { id: "component:frame", kind: "component", role: "component", origin: { project: true }, file: "frame.hbs", schema: null, docs: null }],
      ["stylesheet:header.scss", { id: "stylesheet:header.scss", kind: "stylesheet", origin: { project: true }, component: "header", source: "scss", file: "header.scss" }],
      ["stylesheet:other.scss", { id: "stylesheet:other.scss", kind: "stylesheet", origin: { project: true }, component: null, source: "scss", file: "other.scss" }],
      ["class:site", { id: "class:site", kind: "class", owner: "frame" }],
      ["class:header", { id: "class:header", kind: "class", owner: "header" }],
    ];
    const edges: GraphEdge[] = [
      { kind: "includes", from: "component:frame", to: "component:header" },
      { kind: "styled-by", from: "component:header", to: "stylesheet:header.scss" },
      { kind: "defines", from: "stylesheet:header.scss", to: "class:header", selector: ".header" },
      { kind: "mentions", from: "stylesheet:header.scss", to: "class:site", selector: ".site > .header" },
      { kind: "mentions", from: "stylesheet:other.scss", to: "class:header", selector: ".x .header" },
    ];
    const by = (k: "from" | "to") => { const m = new Map<string, GraphEdge[]>(); for (const e of edges) m.set(e[k], [...m.get(e[k]) ?? [], e]); return m; };
    const graph = { nodes: new Map(nodes), out: by("from"), in: by("to") };
    const r = blastRadiusOf(graph, "header");
    expect(r.components.map(c => c.id)).toEqual(["frame"]);
    expect(r.stylesheets.map(s => s.file)).toEqual(["other.scss"]);
  });

  it("is never the component itself", () => {
    expect(blastRadiusOf(tb.graph, "atoms/button").components.map(c => c.id)).not.toContain("atoms/button");
  });
});

describe("affected", () => {
  it("maps changed files to what they are and lists everything they reach", () => {
    const a = affectedOf(tb.graph, { files: ["src/styles/00-base/_tokens.scss", "src/patterns/molecules/field/field.hbs", "nope.txt"] }, tb.pagesPrefix);
    expect(a.changed).toEqual(["src/patterns/molecules/field/field.hbs", "src/styles/00-base/_tokens.scss"]);
    expect(a.unknown).toEqual(["nope.txt"]);
    expect(a.components).toEqual(expect.arrayContaining(["atoms/button", "molecules/field", "molecules/coupled"]));
  });

  it("a page file is its page, and a component reaches its pages", () => {
    const a = affectedOf(sb.graph, { ids: ["components/icon-label"], files: ["pages/guides/setup.md"] }, sb.pagesPrefix);
    expect(sb.pagesPrefix).toBe("pages/");
    expect(a.pages).toEqual(expect.arrayContaining(["/about/", "/guides/setup/"]));
  });
});

describe("describe", () => {
  it("is the four answers, each the one its own call gives", async () => {
    const d = await describeOf(tb.graph, "atoms/button", tb.discoveryMap);
    expect(d.contract).toEqual(await contractOf(tb.graph, "atoms/button", tb.discoveryMap));
    expect(d.usage).toEqual(usageOf(tb.graph, "atoms/button"));
    expect(d.ownership).toEqual(ownershipOf(tb.graph, "atoms/button"));
    expect(d.blastRadius).toEqual(blastRadiusOf(tb.graph, "atoms/button"));
  });
});
