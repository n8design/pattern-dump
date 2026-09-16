import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";

import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { detectFlattening, type FlatteningInput } from "../src/flattening.js";

const here        = dirname(fileURLToPath(import.meta.url));
const patternsDir = join(here, "../../../test-bench/src/patterns");

const BASE = "atoms/tbflat/tbflat-base";
const WRAP = "atoms/tbflat/tbflat-wrap";

// The four-case contract (§6): catches clean copies, catches the drifted copy, spares the distinct
// sibling, spares legitimate composition. Driven over the REAL discovered test-bench fixtures.
describe("flattening diagnostic — test-bench guard", () => {
  it("clusters clean+drift; spares the different-skeleton sibling and the wrapper/base pair", async () => {
    const { discoveryMap, handleMap } = await buildDiscoveryMap(patternsDir);

    // The synthetic family is discovered as its own components…
    const ids = [...discoveryMap.keys()].filter((id) => id.startsWith("atoms/tbflat/")).sort();
    expect(ids).toEqual([
      "atoms/tbflat/tbflat-a",
      "atoms/tbflat/tbflat-b",
      "atoms/tbflat/tbflat-base",
      "atoms/tbflat/tbflat-c",
      "atoms/tbflat/tbflat-drift",
      "atoms/tbflat/tbflat-sibling",
      "atoms/tbflat/tbflat-wrap",
    ]);
    // …and the wrapper's partial resolves to the base (the composition relationship is real).
    expect(handleMap.get("atoms-tbflat-base")).toBe(BASE);

    const inputs: FlatteningInput[] = [];
    for (const id of ids) {
      inputs.push({ id, hbs: await readFile(discoveryMap.get(id)!.hbsPath, "utf-8") });
    }

    // Production derives this edge from the wrapper's `{{> "atoms-tbflat-base"}}` via the composition
    // registry (wired in surfaceFlattening); assert the fixture genuinely carries it.
    const wrapHbs = await readFile(discoveryMap.get(WRAP)!.hbsPath, "utf-8");
    expect(wrapHbs).toContain('{{> "atoms-tbflat-base"}}');
    const hasEdge = (a: string, b: string) =>
      (a === WRAP && b === BASE) || (a === BASE && b === WRAP);

    const clusters = detectFlattening(inputs, { hasEdge });

    // Exactly one flattened cluster: the three clean copies + the drifted copy.
    expect(clusters).toHaveLength(1);
    const c = clusters[0];
    expect(c.root).toBe("tbflat");
    expect(c.members).toEqual([
      "atoms/tbflat/tbflat-a",
      "atoms/tbflat/tbflat-b",
      "atoms/tbflat/tbflat-c",
      "atoms/tbflat/tbflat-drift",
    ]);

    // The drifted copy IS clustered (similarity, not identity) and its drift surfaces in the deltas.
    const drift = c.deltas.find((d) => d.id === "atoms/tbflat/tbflat-drift");
    expect(drift).toBeDefined();
    expect(drift!.extraClasses).toContain("tbflat__lable");   // the misspelling
    expect(drift!.missingClasses).toContain("tbflat__label"); // the token it should have had

    // The sibling (different skeleton) and the wrapper/base pair (composition edge) are spared.
    const clustered = new Set(clusters.flatMap((x) => x.members));
    expect(clustered.has("atoms/tbflat/tbflat-sibling")).toBe(false);
    expect(clustered.has(BASE)).toBe(false);
    expect(clustered.has(WRAP)).toBe(false);
  });
});
