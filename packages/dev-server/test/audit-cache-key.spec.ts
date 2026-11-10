// The audit's cache (refreshDiagnosticsGraph): a component's cached verdict is reused only when it was made
// from the same input by the same check code. Its key holds the digest of the renderer, a11y and contracts
// code (check-code.ts), so after an upgrade that changes a check the component is audited again instead of
// keeping the verdict the old code gave.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { checkCodeDigest } from "../src/check-code.js";
import {
  componentContentHash, globalDataDigest, graphArtifactPath, refreshDiagnosticsGraph, type CheckRenderer,
} from "../src/diagnostics.js";
import { pdScratchDir } from "../src/scratch.js";
import { save } from "../../../test-support/save.js";

const ID = "atoms/card";
const STALE = "a verdict an earlier check code gave";
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-audit-cache-"));
  for (const [rel, text] of Object.entries({ "atoms/card/card.hbs": "<p>{{title}}</p>\n", "atoms/card/card.json": `{"title":"T"}\n` })) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
});
afterAll(async () => {
  if (root) { await rm(pdScratchDir(root), { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});

const refresh = async () => {
  const discovery = await buildDiscoveryMap(root);
  const render = createRenderer({ patternsDir: root, discoveryMap: discovery.discoveryMap, handleMap: discovery.handleMap }) as CheckRenderer;
  return { ...await refreshDiagnosticsGraph(root, [ID], render, discovery.quarantineMap, discovery.discoveryMap, undefined), discovery };
};

/** The artifact on disk, with the component's cached verdict replaced by a stale one, filed under `hash`. */
async function plantStaleVerdict(hash: (current: string) => Promise<string>): Promise<void> {
  const path = graphArtifactPath(root);
  const art = JSON.parse(await readFile(path, "utf8")) as {
    hashes: Record<string, string>; graph: { occurrences: Array<Record<string, unknown>> };
  };
  art.graph.occurrences = [{ engine: "schema", ruleId: "SHAPE_MISMATCH", component: ID, severity: "warning", message: STALE, tag: "SUBJECT-DEBT" }];
  art.hashes[ID] = await hash(art.hashes[ID]!);
  await save(path, JSON.stringify(art));
}

const messages = (graph: { occurrences: Array<{ component: string; message: string }> }) =>
  graph.occurrences.filter(o => o.component === ID).map(o => o.message);

describe("the audit's cache key", () => {
  it("includes the check code: the same component, judged by other code, has another key", async () => {
    const { discovery } = await refresh();
    const digest = globalDataDigest(undefined);
    const now = await componentContentHash(ID, discovery.discoveryMap, digest);
    expect(now).toBe(await componentContentHash(ID, discovery.discoveryMap, digest, checkCodeDigest()));
    expect(await componentContentHash(ID, discovery.discoveryMap, digest, "other check code")).not.toBe(now);
    expect(checkCodeDigest()).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reuses a verdict cached by the same check code (the cache works)", async () => {
    await refresh();
    await plantStaleVerdict(async current => current);
    const r = await refresh();
    expect(r.reaudited).toEqual([]);
    expect(messages(r.graph)).toEqual([STALE]);
  });

  it("does not reuse a verdict cached by other check code: the component is audited again", async () => {
    const { discovery } = await refresh();
    await plantStaleVerdict(() => componentContentHash(ID, discovery.discoveryMap, globalDataDigest(undefined), "the check code before an upgrade"));
    const r = await refresh();
    expect(r.reaudited).toEqual([ID]);
    expect(messages(r.graph)).not.toContain(STALE);
  });
});
