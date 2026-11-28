// Custom properties in the project graph: the property nodes, a class's uses-property edges (own, and in context with
// the classes it is inside), each stylesheet's and theme's declares edges, a component's properties (propertiesOf)
// and the warning for one declared nowhere and read without a fallback (PROPERTY_UNDECLARED), with
// styles.allowProperties. On
// test/fixtures/graph-properties, shaped like hTWOo: one stylesheet holds two components' rules, so the way to a
// component is the class its template writes, never the stylesheet's name. Over pd dev's /api/graph, and the same
// graph built without a server (pd graph, pd audit, pd mcp), which compiles the themes itself.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildAuditRollup, componentUrl, type ComponentDetailResponse, type GraphEdge, type ProjectGraphJson } from "@pattern-dump/contracts";
import { formatAudit, runDiagnosticsAudit, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { buildProjectGraph } from "../src/graph/standalone.js";
import { graphJson, type ProjectGraph } from "../src/graph/build.js";
import { propertiesOf } from "../src/graph/queries.js";
import { propertyUndeclaredDiagnostics } from "../src/diagnostics.js";
import { resolveServerConfig } from "../src/server-config.js";

const root = fileURLToPath(new URL("./fixtures/graph-properties/", import.meta.url));
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles", entry: "main.scss", allowProperties: ["--pp-run*"] },
  themes: { dir: "./themes", default: "blue", switch: "stylesheet" },
});
let server: DevServer;
let json: ProjectGraphJson;
let graph: ProjectGraph;

beforeAll(async () => {
  server = await startDevServer(validateConfig(config, "graph-properties"), root, { port: 0, wsPort: 0 });
  json = await (await fetch(`http://127.0.0.1:${server.port}/api/graph`)).json() as ProjectGraphJson;
  graph = await buildProjectGraph(resolveServerConfig(config, root, {}, []), { live: true });
}, 60_000);
afterAll(async () => { await server?.close(); });

const edge = (e: Partial<GraphEdge>) => expect.objectContaining(e);
const names = (id: string) => propertiesOf(graph, id).map(p => p.name);

describe("custom properties in the graph", () => {
  it("is the same graph without a server: the themes are compiled there too", () => {
    expect(JSON.stringify(graphJson(graph))).toBe(JSON.stringify(json));
  });

  it("a property is a node; a theme is a stylesheet of no component", () => {
    expect(json.nodes).toContainEqual({ id: "property:--pp-neutral-light", kind: "property" });
    expect(json.nodes).toContainEqual({
      id: "stylesheet:themes/red.theme.scss", kind: "stylesheet", origin: { project: true }, component: null, source: "theme",
      file: "themes/red.theme.scss",
    });
  });

  it("the document card uses the property its Sass variable holds and the one its mixin writes; the facepile none", () => {
    expect(json.edges).toContainEqual(edge({
      kind: "uses-property", from: "class:pp-doccard", to: "property:--pp-neutral-light", selector: ".pp-doccard", context: false,
    }));
    expect(json.edges).toContainEqual(edge({
      kind: "uses-property", from: "class:pp-doccard", to: "property:--pp-focus", selector: ".pp-doccard:focus-within", context: false,
    }));
    expect(names("organisms/cards/doccard")).toEqual(["--pp-focus", "--pp-link", "--pp-neutral-light"]);
    expect(names("molecules/facepile")).toEqual([]);
  });

  it("a use in context is the inner class's, with context: true and the class it is inside", () => {
    const e = json.edges.find(x => x.kind === "uses-property" && x.to === "property:--pp-body-bg");
    expect(e).toEqual({
      kind: "uses-property", from: "class:pp-avatar", to: "property:--pp-body-bg", selector: ".pp-doccard .pp-avatar", context: true,
      within: ["pp-doccard"],
    });
    const avatar = propertiesOf(graph, "atoms/avatar");
    expect(avatar.map(p => [p.name, p.own.length, p.context.length])).toEqual([["--pp-avatar-fg", 1, 0], ["--pp-body-bg", 0, 1]]);
    expect(avatar[1]!.context).toEqual([{ class: "pp-avatar", selector: ".pp-doccard .pp-avatar", within: ["pp-doccard"] }]);
  });

  it("a rule with no class uses and declares from its stylesheet", () => {
    expect(json.edges).toContainEqual(edge({ kind: "uses-property", from: "stylesheet:src/styles/base/_root.scss", to: "property:--pp-gap" }));
    expect(json.edges).toContainEqual(edge({
      kind: "declares", from: "stylesheet:src/styles/base/_root.scss", to: "property:--pp-gap", selector: ":root", context: "plain",
    }));
  });

  it("a property declared in one theme only points to that theme", () => {
    const focus = propertiesOf(graph, "organisms/cards/doccard").find(p => p.name === "--pp-focus")!;
    expect(focus.declaredBy).toEqual([{ file: "themes/red.theme.scss", source: "theme", selector: "[data-theme=red]" }]);
    const fg = propertiesOf(graph, "atoms/avatar").find(p => p.name === "--pp-avatar-fg")!;
    expect(fg.declaredBy.map(d => d.file)).toEqual(["themes/blue.theme.scss", "themes/red.theme.scss"]);
  });

  it("a template's own style attribute declares what it sets: no warning for a rule that reads it", async () => {
    expect(json.edges).toContainEqual({
      kind: "declares", from: "stylesheet:inline:atoms/grid", to: "property:--pp-cols", selector: "[style]", context: "plain",
    });
    expect(propertyUndeclaredDiagnostics("atoms/grid", undefined, graph, [])).toEqual([]);
  });

  it("a use with a fallback is an API property with a default: no warning, and the edge carries the fallback", () => {
    expect(json.edges).toContainEqual({
      kind: "uses-property", from: "class:pp-dialog", to: "property:--pp-dlg-width", selector: ".pp-dialog", context: false,
      fallback: "30rem",
    });
    const width = propertiesOf(graph, "atoms/dialog").find(p => p.name === "--pp-dlg-width")!;
    expect(width).toEqual({ name: "--pp-dlg-width", own: [{ class: "pp-dialog", selector: ".pp-dialog", fallback: "30rem" }], context: [], declaredBy: [] });
    expect(propertyUndeclaredDiagnostics("atoms/dialog", undefined, graph, []).map(d => d.message))
      .not.toContainEqual(expect.stringContaining("--pp-dlg-width"));
  });

  it("a property used once with and once without a fallback warns, naming the use without one", () => {
    expect(propertyUndeclaredDiagnostics("atoms/dialog", undefined, graph, []).map(d => d.message)).toEqual([
      expect.stringMatching(/^var\(--pp-dlg-gap\) in \.pp-dialog-body has no fallback and reads a custom property/),
    ]);
  });

  it("a property declared nowhere is a warning on the component, and styles.allowProperties silences it", async () => {
    const badge = propertiesOf(graph, "atoms/badge");
    expect(badge.map(p => [p.name, p.declaredBy.length])).toEqual([["--pp-runtime", 0], ["--pp-undeclared", 0]]);
    expect(propertyUndeclaredDiagnostics("atoms/badge", undefined, graph, []).map(d => d.message)).toEqual([
      expect.stringMatching(/^var\(--pp-runtime\) in \.pp-badge has no fallback and reads a custom property that no stylesheet or theme declares/),
      expect.stringMatching(/^var\(--pp-undeclared\) /),
    ]);
    // Over pd dev's detail, with the config's list (a prefix): one warning left.
    const detail = await (await fetch(`http://127.0.0.1:${server.port}${componentUrl("atoms/badge")}`)).json() as ComponentDetailResponse;
    const found = detail.diagnostics.filter(d => d.kind === "PROPERTY_UNDECLARED");
    expect(found).toEqual([{
      kind: "PROPERTY_UNDECLARED", severity: "warning", source: "render",
      message: "var(--pp-undeclared) in .pp-badge has no fallback and reads a custom property that no stylesheet or theme "
        + "declares: give it a fallback (var(--pp-undeclared, ...)), declare it in a theme or stylesheet, or, if a script or "
        + "the site that uses the design system sets it, list it in styles.allowProperties",
    }]);
    // A component whose every property is declared has none.
    const card = await (await fetch(`http://127.0.0.1:${server.port}${componentUrl("organisms/cards/doccard")}`)).json() as ComponentDetailResponse;
    expect(card.diagnostics.filter(d => d.kind === "PROPERTY_UNDECLARED")).toEqual([]);
  });

  it("pd audit lists them beside the findings, with component, property and place, and a total of their own", async () => {
    const { graph: audit, style } = await runDiagnosticsAudit(validateConfig(config, "graph-properties"), root);
    // The allow list applies (--pp-runtime), and a property with a fallback everywhere (--pp-dlg-width) is no warning.
    expect(style.undeclared).toEqual([
      { component: "atoms/badge", property: "--pp-undeclared", selectors: [".pp-badge"] },
      { component: "atoms/dialog", property: "--pp-dlg-gap", selectors: [".pp-dialog-body"] },
    ]);
    const md = formatAudit(audit, "md", { style });
    expect(md).toContain("## Custom properties declared nowhere (PROPERTY_UNDECLARED: warnings, not in the defect count)\n\n"
      + "2 properties in 2 components.\n\n"
      + "- atoms/badge reads `--pp-undeclared` without a fallback in `.pp-badge`, and nothing declares it\n"
      + "- atoms/dialog reads `--pp-dlg-gap` without a fallback in `.pp-dialog-body`, and nothing declares it\n");
    expect(formatAudit(audit, "text", { style })).toContain(
      "Custom properties declared nowhere (PROPERTY_UNDECLARED: warnings, not in the defect count): 2 properties in 2 components\n"
      + "  atoms/badge reads --pp-undeclared without a fallback in .pp-badge, and nothing declares it\n");
    // Never in the defect count: the findings are CSS-invariant.
    const rollup = buildAuditRollup(audit, { style });
    expect(rollup.undeclaredTotals).toEqual({ properties: 2, components: 2 });
    expect(audit.occurrences.filter(o => o.ruleId === "PROPERTY_UNDECLARED")).toEqual([]);
    expect(rollup.totals.defects).toBe(audit.occurrences.length);
    // INLINE_STYLE is a finding: it comes from the template, which the hash covers. The grid's style attribute sets
    // a custom property only, so it has none; the dialog's sets max-height too.
    const inline = audit.occurrences.filter(o => o.ruleId === "INLINE_STYLE");
    expect(inline.map(o => [o.component, o.message.split(",")[0]])).toEqual([["atoms/dialog", "the style attribute sets max-height: 50vh"]]);
    expect(rollup.rulesByBlast).toContainEqual(expect.objectContaining({ engine: "render", ruleId: "INLINE_STYLE", components: 1, occurrences: 1 }));
  }, 60_000);
});
