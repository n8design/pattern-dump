// The audit seed and the persisted audit (diagnostics.ts, routes.ts):
// - each persisted hash is the hash of the content that was audited, captured at audit time, never read
//   from disk when persisting: otherwise a file changed after its audit is persisted with its new hash and
//   the old findings, and a later cold start reuses findings that no longer hold;
// - requests during a seed share it, and a component saved during the seed is audited again before the
//   seed is stored (the documented deviation from lazy.ts's "never stored").
// The moment during the seed is the test-only hook `__testOnly_onLazy("audit-seed", "built")`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { startDevServer } from "@pattern-dump/dev-server";
import { pdScratchDir } from "../src/scratch.js";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";

type LazyHook = (name: string, phase: "built" | "taken", invalidate: () => void) => void | Promise<void>;
const hooks = globalThis as { __testOnly_onLazy?: LazyHook };

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
}), "site");
const FILE = "src/patterns/atoms/x/x.hbs";
const DEFECT = `<button class="x"><div>block inside a button</div></button>\n`;
const CLEAN = `<button class="x">fine</button>\n`;

type Audit = { occurrences: Array<{ component: string; ruleId: string }>; _liveReaudits: number };
const findings = (a: Audit) => a.occurrences.filter(o => o.component === "atoms/x").map(o => o.ruleId);

let tmp = "";
let n = 0;
const roots: string[] = [];
async function site(): Promise<string> {
  const root = join(tmp, `site-${n++}`);
  roots.push(root);
  await mkdir(dirname(join(root, FILE)), { recursive: true });
  await writeFile(join(root, FILE), DEFECT);
  await writeFile(join(root, "src/patterns/atoms/y.hbs"), `<p>other</p>\n`);
  await mkdir(join(root, "src/styles"), { recursive: true });
  return root;
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-audit-seed-")); });
afterEach(() => { delete hooks.__testOnly_onLazy; });
afterAll(async () => {
  await closeAll();
  for (const root of roots) await rm(pdScratchDir(root), { recursive: true, force: true });
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("the persisted audit", () => {
  it("keeps the hash of what was audited: a file changed after its audit is audited again on the next cold start", async () => {
    const root = await site();
    // No watcher: the in-memory slice keeps the audit of the defect while the file changes under it.
    const first = await startDevServer(config, root, { port: 0, live: false });
    try {
      const audit = async () => (await fetch(`http://127.0.0.1:${first.port}/api/audit`)).json() as Promise<Audit>;
      expect(findings(await audit())).toContain("element-permitted-content");
      await writeFile(join(root, FILE), CLEAN);
      // Warm: assembled from memory, and persisted.
      expect(findings(await audit())).toContain("element-permitted-content");
    } finally {
      await first.close();
    }
    // A cold start on the same root: the persisted hash is of the defect, the file is clean, so the
    // component is audited again rather than its stale findings reused.
    const second = await startDevServer(config, root, { port: 0, live: false });
    try {
      const cold = await (await fetch(`http://127.0.0.1:${second.port}/api/audit`)).json() as Audit;
      expect(findings(cold)).toEqual([]);
    } finally {
      await second.close();
    }
  }, 60_000);
});

describe("a seed", () => {
  it("is shared by requests during it, and audits a component saved during it again before it is stored", async () => {
    const root = await site();
    const b = new Bench(root, null, join(tmp, "staging"));
    await b.start(config);

    let seeds = 0;
    hooks.__testOnly_onLazy = async (name, phase) => {
      if (name !== "audit-seed" || phase !== "built") return;
      seeds++;
      if (seeds > 1) return;
      // The seed has audited the defect; now the component is saved, and the watcher handles the save.
      const from = handled.length;
      await writeFile(b.at(FILE), CLEAN);
      await whenHandled(() => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === FILE && h.event === "change"));
    };
    const [one, two] = await Promise.all([
      fetch(`${b.origin}/api/audit`).then(r => r.json() as Promise<Audit>),
      fetch(`${b.origin}/api/audit`).then(r => r.json() as Promise<Audit>),
    ]);
    // One seed for both requests, kept, with the saved component audited again: its finding is gone, and
    // that was the only re-audit after the seed.
    expect(seeds).toBe(1);
    expect(findings(one)).toEqual([]);
    expect(findings(two)).toEqual([]);
    expect(one._liveReaudits).toBe(1);
  }, 60_000);
});
