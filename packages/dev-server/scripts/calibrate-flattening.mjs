// Calibration harness for the flattening diagnostic — NOT a committed hard-assert.
// Runs the detector against (1) the synthetic test-bench family (known answer) and (2) the frozen
// hTWOo corpus READ-ONLY (known clusters: ql-list-button-* and the button family), sweeping theta,
// and prints FP/FN so a human can choose the metric + threshold. hTWOo is never a fixture; this only
// reads it. Data decides theta — not this script.
//
// Usage:  npm run build --workspace @pattern-dump/dev-server \
//      && npm run build --workspace @pattern-dump/discovery \
//      && node packages/dev-server/scripts/calibrate-flattening.mjs

import { readdir, readFile } from "node:fs/promises";
import { join, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { detectFlattening } from "@pattern-dump/dev-server";
import { buildDiscoveryMap } from "@pattern-dump/discovery";

const repo = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

const partialsOf = (hbs) => {
  const out = new Set();
  for (const m of hbs.matchAll(/\{\{#?>\s*"([^"]+)"/g)) out.add(m[1]);
  for (const m of hbs.matchAll(/\{\{#?>\s*([a-zA-Z][a-zA-Z0-9-]*)/g)) out.add(m[1]);
  return [...out];
};

async function walkHbs(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkHbs(full)));
    else if (e.name.endsWith(".hbs")) out.push(full);
  }
  return out;
}

/** Gather {inputs, hasEdge} by globbing a dir directly (id = path relative to dir, no discovery). */
async function gatherGlob(dir) {
  const files = (await walkHbs(dir)).sort();
  const inputs = [];
  const handleToId = new Map();
  const usesByFile = new Map();
  for (const f of files) {
    const id = relative(dir, f).replace(/\.hbs$/, "");
    const hbs = await readFile(f, "utf-8");
    inputs.push({ id, hbs });
    handleToId.set(basename(id), id);          // best-effort handle (basename) → id
    usesByFile.set(id, partialsOf(hbs));
  }
  const uses = new Map();
  for (const { id } of inputs) {
    uses.set(id, (usesByFile.get(id) ?? []).map((h) => handleToId.get(h)).filter(Boolean));
  }
  const hasEdge = (a, b) => (uses.get(a)?.includes(b) ?? false) || (uses.get(b)?.includes(a) ?? false);
  return { inputs, hasEdge };
}

/** Gather from a real PD project via discovery (test-bench), with real composition edges. */
async function gatherProject(patternsDir) {
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patternsDir);
  const inputs = [];
  const uses = new Map();
  for (const [id, entry] of discoveryMap) {
    if (id.includes("~") || !entry.hbsPath) continue;
    const hbs = await readFile(entry.hbsPath, "utf-8");
    inputs.push({ id, hbs });
    uses.set(id, partialsOf(hbs).map((h) => handleMap.get(h)).filter(Boolean));
  }
  const hasEdge = (a, b) => (uses.get(a)?.includes(b) ?? false) || (uses.get(b)?.includes(a) ?? false);
  return { inputs, hasEdge };
}

const THETAS = [0.80, 0.85, 0.90, 0.95, 1.0];

function summarize(label, inputs, hasEdge, opts = {}) {
  console.log(`\n===== ${label}  (${inputs.length} components) =====`);
  for (const theta of THETAS) {
    const clusters = detectFlattening(inputs, { ...opts, theta, hasEdge });
    const sizes = clusters.map((c) => c.members.length).sort((a, b) => b - a);
    const inClusters = clusters.reduce((n, c) => n + c.members.length, 0);
    console.log(
      `θ=${theta.toFixed(2)}  clusters=${clusters.length}  clustered-components=${inClusters}  sizes=[${sizes.join(",")}]`,
    );
  }
  return detectFlattening(inputs, { ...opts, theta: 0.9, hasEdge });
}

// ---- 1. Synthetic (test-bench) — known answer ----
{
  const { inputs, hasEdge } = await gatherProject(join(repo, "test-bench/src/patterns"));
  const fam = inputs.filter((i) => i.id.startsWith("atoms/tbflat/"));
  const clusters = detectFlattening(fam, { hasEdge, theta: 0.9 });
  const members = clusters.flatMap((c) => c.members);
  const ok =
    clusters.length === 1 &&
    ["a", "b", "c", "drift"].every((s) => members.includes(`atoms/tbflat/tbflat-${s}`)) &&
    !members.includes("atoms/tbflat/tbflat-sibling") &&
    !members.includes("atoms/tbflat/tbflat-base") &&
    !members.includes("atoms/tbflat/tbflat-wrap");
  console.log(`\n===== SYNTHETIC test-bench family =====\nfour-case contract: ${ok ? "PASS" : "FAIL"}`);
}

// ---- 2. hTWOo READ-ONLY — quick-links (ql-list-button-* archetype) ----
{
  const dir = join(repo, ".htwoo-src/htwoo-repo/htwoo-core/src/_patterns/molecules/quick-links");
  const { inputs, hasEdge } = await gatherGlob(dir);
  const clusters = summarize("hTWOo quick-links", inputs, hasEdge);
  const ql = inputs.filter((i) => i.id.startsWith("ql-list-button")).map((i) => i.id);
  const clustered = new Set(clusters.flatMap((c) => c.members));
  const recall = ql.filter((id) => clustered.has(id)).length;
  const leaked = [...clustered].filter((id) => !id.startsWith("ql-list-button"));
  console.log(`ground-truth ql-list-button-*: ${ql.length}; clustered at θ=0.9: ${recall} (recall)`);
  console.log(`non-ql-list-button ids that leaked into clusters (precision check): [${leaked.join(", ")}]`);
  for (const c of clusters) {
    console.log(`  cluster root=${c.root} members=${c.members.length}: ${c.members.join(", ")}`);
    for (const d of c.deltas) console.log(`    drift ${d.id}: +[${d.extraClasses}] -[${d.missingClasses}]`);
  }
}

// ---- 3. hTWOo READ-ONLY — button family ----
{
  const dir = join(repo, ".htwoo-src/htwoo-repo/htwoo-core/src/_patterns/atoms/buttons");
  const { inputs, hasEdge } = await gatherGlob(dir);
  const clusters = summarize("hTWOo atoms/buttons", inputs, hasEdge);
  for (const c of clusters) {
    console.log(`  cluster root=${c.root} members=${c.members.length}: ${c.members.slice(0, 12).join(", ")}${c.members.length > 12 ? " …" : ""}`);
  }
}
