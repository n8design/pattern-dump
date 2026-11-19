// pd audit reports a component a handle collision quarantined: it is left out of the tree, so without this the
// audit simply never mentions it. It is an entry of its own with a HANDLE_COLLISION defect (engine "discovery")
// naming the handle and the component that keeps it; renaming one of them clears it on the next audit, and the
// incumbent is audited as usual. The scope lists discovery as covered.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { AUDIT_SCOPE, buildAuditRollup } from "@pattern-dump/contracts";
import { runDiagnosticsAudit } from "../src/audit.js";
import { auditInputs, componentContentHash } from "../src/diagnostics.js";
import { pdScratchDir } from "../src/scratch.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let root = "";
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-audit-quarantine-"));
  root = join(tmp, "p");
  // atoms/card/card-2 and atoms/card-2/card-2 share the handle atoms-card-2: the first by sorted path keeps it.
  for (const [rel, text] of Object.entries({
    "src/patterns/atoms/card-2/card-2.hbs": `<p>incumbent</p>\n`,
    "src/patterns/atoms/card/card-2.hbs": `<p>newcomer</p>\n`,
  })) await save(join(root, rel), text);
});
afterAll(async () => {
  if (root) await rm(pdScratchDir(root), { recursive: true, force: true });
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
}), "audit");

describe("pd audit and quarantined components", () => {
  it("the quarantined component is an entry with a HANDLE_COLLISION defect; the incumbent is audited as usual", async () => {
    const { graph } = await runDiagnosticsAudit(config, root);
    expect(graph.components.map(c => c.id).sort()).toEqual(["atoms/card-2", "atoms/card/card-2"]);
    const found = graph.occurrences.filter(o => o.component === "atoms/card/card-2");
    expect(found).toMatchObject([{ engine: "discovery", ruleId: "HANDLE_COLLISION", severity: "error" }]);
    expect(found[0]!.message).toContain("atoms-card-2");
    expect(found[0]!.message).toContain("atoms/card-2");
    expect(graph.occurrences.filter(o => o.component === "atoms/card-2")).toEqual([]);
    expect(buildAuditRollup(graph).perComponent.map(c => c.id)).toEqual(["atoms/card/card-2"]);
  }, 60_000);

  it("renaming one of them clears it on the next audit", async () => {
    await rename(join(root, "src/patterns/atoms/card/card-2.hbs"), join(root, "src/patterns/atoms/card/card-3.hbs"));
    const { graph } = await runDiagnosticsAudit(config, root);
    expect(graph.components.map(c => c.id).sort()).toEqual(["atoms/card-2", "atoms/card/card-3"]);
    expect(graph.occurrences.filter(o => o.ruleId === "HANDLE_COLLISION")).toEqual([]);
  }, 60_000);

  // Its cached verdict names who keeps the handle, so its cache key changes when that does.
  it("a quarantined component's cache key covers the collision", async () => {
    const entry = { handle: "atoms-x", incumbentId: "atoms/x", incumbentPath: "/p/atoms/x/x.hbs", quarantinedPath: "/p/atoms/y/x.hbs", quarantinedId: "atoms/y/x" };
    const key = async (quarantine?: Map<string, typeof entry>) => componentContentHash("atoms/y/x", await auditInputs({
      discoveryMap: new Map(), handleMap: new Map(), composition: { uses: new Map(), usedBy: new Map() } as never, globalData: undefined,
      ...(quarantine ? { quarantine } : {}),
    }));
    const one = await key(new Map([["atoms/y/x", entry]]));
    expect(await key(new Map([["atoms/y/x", { ...entry, incumbentId: "atoms/z/x" }]]))).not.toBe(one);
    expect(await key()).not.toBe(one);
  });

  it("the audit's scope lists discovery as covered", () => {
    expect(AUDIT_SCOPE.covered.map(c => c.name)).toContain("Discovery");
  });
});
