// pd audit renders every variant, not only each component's default render: a data overlay (`name~v.json`) and a
// variant with markup of its own (`name~v.hbs`) are entries of their own, `base~v`, in the graph, the report's
// per-component list and a rule's blast radius. A variant's own file is in its cache key, so an edit to it shows on
// the next audit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildAuditRollup } from "@pattern-dump/contracts";
import { runDiagnosticsAudit } from "../src/audit.js";
import { pdScratchDir } from "../src/scratch.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;
const roots: string[] = [];
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-audit-variants-")); });
afterAll(async () => {
  for (const r of roots) await rm(pdScratchDir(r), { recursive: true, force: true });
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
}), "audit");

/** A box whose `nested` flag puts a <div> in a <span>: html-validate's element-permitted-content, where it renders. */
const BOX = `<span class="box">{{#if nested}}<div>{{label}}</div>{{else}}{{label}}{{/if}}</span>\n`;

async function project(files: Record<string, string>): Promise<string> {
  const root = join(tmp, `p-${n++}`);
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) await save(join(root, rel), text);
  return root;
}
const rulesOf = (graph: Awaited<ReturnType<typeof runDiagnosticsAudit>>["graph"], id: string): string[] =>
  graph.occurrences.filter(o => o.component === id).map(o => o.ruleId);

describe("pd audit and variants", () => {
  it("a data overlay is audited with its data: its defect is its own, the base stays clean", async () => {
    const root = await project({
      "src/patterns/atoms/box/box.hbs": BOX,
      "src/patterns/atoms/box/box.json": `{ "label": "Plain" }\n`,
      "src/patterns/atoms/box/box~nested.json": `{ "nested": true }\n`,
    });
    const { graph } = await runDiagnosticsAudit(config, root);
    expect(graph.components.map(c => c.id)).toEqual(["atoms/box", "atoms/box~nested"]);
    expect(rulesOf(graph, "atoms/box")).toEqual([]);
    expect(rulesOf(graph, "atoms/box~nested")).toContain("element-permitted-content");
    const rollup = buildAuditRollup(graph);
    expect(rollup.totals).toMatchObject({ components: 2, affected: 1 });
    expect(rollup.perComponent.map(c => c.id)).toEqual(["atoms/box~nested"]);
  }, 60_000);

  it("a variant with markup of its own is audited from its own template; each variant counts in a rule's blast radius", async () => {
    const root = await project({
      "src/patterns/atoms/box/box.hbs": BOX,
      "src/patterns/atoms/box/box.json": `{ "label": "Plain" }\n`,
      "src/patterns/atoms/box/box~own.hbs": `<span><div>own</div></span>\n`,
      "src/patterns/atoms/box/box~nested.json": `{ "nested": true }\n`,
    });
    const { graph } = await runDiagnosticsAudit(config, root);
    expect(rulesOf(graph, "atoms/box~own")).toContain("element-permitted-content");
    const rule = buildAuditRollup(graph).rulesByBlast.find(r => r.ruleId === "element-permitted-content");
    expect(rule?.components).toBe(2);
  }, 60_000);

  it("a variant that throws is an error render of its own", async () => {
    const root = await project({
      "src/patterns/atoms/box/box.hbs": BOX,
      "src/patterns/atoms/box/box~broken.hbs": `<span>{{#each}}</span>\n`,
    });
    const { graph } = await runDiagnosticsAudit(config, root);
    expect(graph.components.find(c => c.id === "atoms/box~broken")?.render).toBe("error");
    expect(graph.components.find(c => c.id === "atoms/box")?.render).toBe("ok");
  }, 60_000);

  it("an edit to a variant's data shows on the next audit, not the cached verdict", async () => {
    const root = await project({
      "src/patterns/atoms/box/box.hbs": BOX,
      "src/patterns/atoms/box/box~nested.json": `{ "nested": true }\n`,
    });
    expect(rulesOf((await runDiagnosticsAudit(config, root)).graph, "atoms/box~nested")).toContain("element-permitted-content");
    await save(join(root, "src/patterns/atoms/box/box~nested.json"), `{ "nested": false, "label": "Fixed" }\n`);
    const again = await runDiagnosticsAudit(config, root);
    expect(again.reaudited).toContain("atoms/box~nested");
    expect(rulesOf(again.graph, "atoms/box~nested")).toEqual([]);
  }, 60_000);
});
