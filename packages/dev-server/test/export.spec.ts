// B7 slice 1 — export collapse-and-emit guard (synthetic, isolated).
//
// Builds a small shape-(a) family in a temp dir and exercises the full pipeline: gate → collapse →
// write → RE-DERIVE. hTWOo is the read-only manual validation target and is never a committed
// fixture; this synthetic family is the committed regression. It is deliberately its OWN temp fixture
// (not test-bench's `tbflat`) so it can't perturb the flattening-calibration spec's "exactly one
// cluster" assertion.
//
// The load-bearing case: a `</meuu>`-style malformed tag lives in the SHARED skeleton. Faithful means
// it rides into the ONE collapsed base VERBATIM — N→1 (one defect, in one place), never N→0 (PD does
// not silently repair the subject). We assert it survives at the file level AND in the render.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDiscoveryMap, collapseComponentId } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { detectFlattening, type FlatteningInput } from "../src/flattening.js";
import { planExport, writeExport, writeThreadedIncluders } from "../src/index.js";

// Two members, byte-identical except the ROOT class token (` loud`) and their data — lossless shape
// (a). The `</meuu>` typo is in BOTH, in the shared skeleton.
const WIDGET      = `<button class="hoo-widget" type="button">{{label}}</meuu></button>\n`;
const WIDGET_LOUD = `<button class="hoo-widget loud" type="button">{{label}}</meuu></button>\n`;

let srcRoot: string;
let outRoot: string;

beforeAll(async () => {
  srcRoot = await mkdtemp(join(tmpdir(), "pd-export-src-"));
  outRoot = await mkdtemp(join(tmpdir(), "pd-export-out-"));
  const dir = join(srcRoot, "atoms", "widget");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "widget.hbs"), WIDGET);
  await writeFile(join(dir, "widget-loud.hbs"), WIDGET_LOUD);
  await writeFile(join(dir, "widget.json"), JSON.stringify({ label: "Hi" }));
  await writeFile(join(dir, "widget-loud.json"), JSON.stringify({ label: "Loud!" })); // differs → delta
});

afterAll(async () => {
  await rm(srcRoot, { recursive: true, force: true });
  await rm(outRoot, { recursive: true, force: true });
});

describe("pd export — collapse-and-emit (shape (a), leaf)", () => {
  it("gate passes only the lossless leaf; collapses to one base + ~variants; typo rides in verbatim", async () => {
    const plan = await planExport({ patternsDir: "." } as never, srcRoot);

    // Exactly one family collapses; nothing deferred or skipped (a clean leaf).
    expect(plan.deferred).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.collapse).toHaveLength(1);

    const fam = plan.collapse[0];
    expect(fam.baseId).toBe("atoms/widget");
    expect(fam.root).toBe("hoo-widget");
    // Base skeleton: root class lifted to a data token; the </meuu> typo preserved VERBATIM (N→1).
    expect(fam.baseHbs).toContain('class="hoo-widget{{ modifier }}"');
    expect(fam.baseHbs).toContain("</meuu>");
    expect(fam.baseData).toEqual({ label: "Hi" });

    const byToken = Object.fromEntries(fam.variants.map((v) => [v.token, v]));
    expect(byToken[""].modifier).toBe("");                 // base-default member
    expect(byToken["loud"].modifier).toBe(" loud");
    expect(byToken["loud"].data).toEqual({ label: "Loud!" }); // data delta threaded (§6)
  });

  it("writes base + defaults + ~overlay; the base carries the typo exactly once", async () => {
    const plan = await planExport({ patternsDir: "." } as never, srcRoot);
    const { files } = await writeExport(plan.collapse, outRoot);
    expect(files).toEqual([
      "atoms/widget.hbs",
      "atoms/widget.json",
      "atoms/widget~loud.json",
    ]);

    const baseHbs = await readFile(join(outRoot, "atoms/widget.hbs"), "utf-8");
    // N→1: the two source copies each had </meuu>; the one collapsed base has it once, not zero.
    expect(baseHbs.match(/<\/meuu>/g)).toHaveLength(1);

    const overlay = JSON.parse(await readFile(join(outRoot, "atoms/widget~loud.json"), "utf-8"));
    expect(overlay).toEqual({ modifier: " loud", label: "Loud!" });
  });

  it("re-derives: one base + one variant, identity stable, sprawl gone, render-equivalent", async () => {
    // discovery on the exported form
    const { discoveryMap } = await buildDiscoveryMap(outRoot);
    expect(discoveryMap.get("atoms/widget")?.hbsPath).toBeTruthy();
    const variants = [...discoveryMap.keys()].filter((id) => id.startsWith("atoms/widget~"));
    expect(variants).toEqual(["atoms/widget~loud"]);

    // identity round-trip — annotate-never-mint: same collapseComponentId as the source base.
    expect(collapseComponentId("atoms/widget/widget")).toBe("atoms/widget");
    expect(collapseComponentId("atoms/widget")).toBe("atoms/widget");

    // flattening detector over the exported form → the widget cluster is gone.
    const inputs: FlatteningInput[] = [];
    for (const [id, e] of discoveryMap) {
      if (id.includes("~") || !e.hbsPath) continue;
      inputs.push({ id, hbs: await readFile(e.hbsPath, "utf-8") });
    }
    expect(detectFlattening(inputs, { hasEdge: () => false }).find((c) => c.root === "hoo-widget")).toBeUndefined();

    // render equivalence — exported variant/base DOM === source, typo included.
    const norm = (h: string) => h.replace(/\s+/g, " ").trim();
    const rSrc = createRenderer({ patternsDir: join(srcRoot) });
    const rOut = createRenderer({ patternsDir: join(outRoot) });

    const srcLoud = (await rSrc({ component: "atoms/widget/widget-loud" })).html;
    const outLoud = (await rOut({ component: "atoms/widget", variant: "loud" })).html;
    expect(norm(outLoud)).toBe(norm(srcLoud));
    expect(outLoud).toContain("</meuu>");           // faithful ride-through at render level
    expect(outLoud).toContain("hoo-widget loud");
    expect(outLoud).toContain("Loud!");

    // Source base id collapses (folder basename == stem): atoms/widget/widget.hbs → id "atoms/widget".
    const srcBase = (await rSrc({ component: "atoms/widget" })).html;
    const outBase = (await rOut({ component: "atoms/widget" })).html;
    expect(norm(outBase)).toBe(norm(srcBase));
    expect(outBase).toContain("</meuu>");
  });
});

// B7 slice 2 — include-param threading, RE-DERIVE THROUGH THE INCLUDE BOUNDARY (the correctness proof).
//
// Slice 1 proved a collapsed LEAF renders identically. Slice 2's bar is one level up: the INCLUDING
// molecule must render identically when its include is rewritten from the flat member to the collapsed
// base + threaded `modifier`. Own temp fixture (not tbflat — a usedBy edge there would perturb the
// flattening-calibration spec's "exactly one cluster" assertion).
//
// ADD-NEVER-OVERWRITE, PROVEN IN THE DOM: the include carries pre-existing params (`tone`, `label`) that
// the component renders into observable output (`data-tone`, text). A rewrite that dropped a param would
// change the rendered DOM and fail the equivalence — not just the file text.
const CHIP      = `<span class="hoo-chip" data-tone="{{tone}}">{{label}}</span>\n`;
const CHIP_LOUD = `<span class="hoo-chip loud" data-tone="{{tone}}">{{label}}</span>\n`;
// The includer passes ALL data via params (no sidecar), so the exported sink render is self-contained
// and the equivalence isolates the threading, not sidecar copying.
const BAR       = `<div class="bar">{{> atoms-chip-loud tone="warn" label="Hi" }}</div>\n`;

let t2SrcRoot: string;
let t2OutRoot: string;

describe("pd export — threading through the include boundary (slice 2)", () => {
  beforeAll(async () => {
    t2SrcRoot = await mkdtemp(join(tmpdir(), "pd-thread-src-"));
    t2OutRoot = await mkdtemp(join(tmpdir(), "pd-thread-out-"));
    const chipDir = join(t2SrcRoot, "atoms", "chip");
    const barDir  = join(t2SrcRoot, "molecules", "bar");
    await mkdir(chipDir, { recursive: true });
    await mkdir(barDir, { recursive: true });
    await writeFile(join(chipDir, "chip.hbs"), CHIP);
    await writeFile(join(chipDir, "chip-loud.hbs"), CHIP_LOUD);
    await writeFile(join(barDir, "bar.hbs"), BAR);
  });

  afterAll(async () => {
    await rm(t2SrcRoot, { recursive: true, force: true });
    await rm(t2OutRoot, { recursive: true, force: true });
  });

  it("routes the include-consumed shape-(a) family to `threaded`, not collapse/deferred", async () => {
    const plan = await planExport({ patternsDir: "." } as never, t2SrcRoot);
    expect(plan.collapse).toHaveLength(0);   // chip is include-consumed → not a leaf collapse
    expect(plan.deferred).toHaveLength(0);   // it IS shape (a), so not deferred
    expect(plan.skipped).toHaveLength(0);
    expect(plan.threaded).toHaveLength(1);

    const fam = plan.threaded[0].family;
    expect(fam.baseId).toBe("atoms/chip");
    expect(fam.baseHbs).toContain('class="hoo-chip{{ modifier }}"');
    const loud = fam.variants.find((v) => v.token === "loud")!;
    expect(loud.modifier).toBe(" loud");     // lifted, faithful
    // the hazard site is the bar includer
    expect(Object.values(plan.threaded[0].hazardSites).flat()).toContain("molecules/bar");
  });

  it("rewrites the includer: base handle + ADDED modifier, pre-existing params preserved", async () => {
    const plan = await planExport({ patternsDir: "." } as never, t2SrcRoot);
    await writeExport(plan.threaded.map((t) => t.family), t2OutRoot);
    const { files, rewrites } = await writeThreadedIncluders(plan.threaded, join(t2SrcRoot), t2OutRoot);
    expect(files).toEqual(["molecules/bar/bar.hbs"]);
    expect(rewrites).toBe(1);

    const bar = await readFile(join(t2OutRoot, "molecules/bar/bar.hbs"), "utf-8");
    expect(bar).toContain("atoms-chip");        // handle swapped to the base
    expect(bar).not.toContain("atoms-chip-loud"); // old flat handle gone
    expect(bar).toContain('tone="warn"');       // pre-existing param SURVIVES
    expect(bar).toContain('label="Hi"');        // pre-existing param SURVIVES
    expect(bar).toContain('modifier=" loud"');  // modifier ADDED, faithful value
  });

  it("re-derives: identity round-trip, sprawl gone, and the INCLUDING molecule renders the SAME DOM", async () => {
    // ensure the sink is written (order-independent of the prior it())
    const plan = await planExport({ patternsDir: "." } as never, t2SrcRoot);
    await writeExport(plan.threaded.map((t) => t.family), t2OutRoot);
    await writeThreadedIncluders(plan.threaded, join(t2SrcRoot), t2OutRoot);

    // identity + sprawl: chip re-derives as base + ~loud, zero clusters in the sink.
    const { discoveryMap } = await buildDiscoveryMap(t2OutRoot);
    expect(discoveryMap.get("atoms/chip")?.hbsPath).toBeTruthy();
    expect([...discoveryMap.keys()].filter((id) => id.startsWith("atoms/chip~"))).toEqual(["atoms/chip~loud"]);
    expect(collapseComponentId("atoms/chip/chip")).toBe("atoms/chip");
    const inputs: FlatteningInput[] = [];
    for (const [id, e] of discoveryMap) {
      if (id.includes("~") || !e.hbsPath) continue;
      inputs.push({ id, hbs: await readFile(e.hbsPath, "utf-8") });
    }
    expect(detectFlattening(inputs, { hasEdge: () => false }).find((c) => c.root === "hoo-chip")).toBeUndefined();

    // THE BAR — the proof: the including molecule's DOM is identical before (flat include) vs after
    // (param-threaded include). This is where slice 2's correctness lives.
    const norm = (h: string) => h.replace(/\s+/g, " ").trim();
    const rSrc = createRenderer({ patternsDir: t2SrcRoot });
    const rOut = createRenderer({ patternsDir: t2OutRoot });
    const srcBar = (await rSrc({ component: "molecules/bar" })).html;
    const outBar = (await rOut({ component: "molecules/bar" })).html;
    expect(norm(outBar)).toBe(norm(srcBar));         // behaviour-preserving across the include boundary
    expect(outBar).toContain('class="hoo-chip loud"'); // modifier threaded → same class
    expect(outBar).toContain('data-tone="warn"');      // pre-existing param intact in the render
    expect(outBar).toContain("Hi");                    // pre-existing param intact in the render
  });
});
