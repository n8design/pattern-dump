// A template save reloads its component only once the surgical re-audit of it has finished, so the audit
// facet, which refetches on that reload, never gets the findings from before the save; and a re-audit that
// fails is reported and the reload still goes out after it. The re-audit is held or failed with the
// test-only hook `__testOnly_onReaudit`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { pdScratchDir } from "../src/scratch.js";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";

const hooks = globalThis as { __testOnly_onReaudit?: (componentId: string) => Promise<void> | undefined };
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});
const FILE = "src/patterns/atoms/x/x.hbs";
const SWAP = `{"type":"content-swap","componentId":"atoms/x"}`;
type Audit = { occurrences: Array<{ component: string; ruleId: string }> };

let tmp = "";
let n = 0;
const roots: string[] = [];
async function project(): Promise<Bench> {
  const root = join(tmp, `site-${n++}`);
  roots.push(root);
  await mkdir(dirname(join(root, FILE)), { recursive: true });
  await writeFile(join(root, FILE), `<button class="x"><div>block inside a button</div></button>\n`);
  await mkdir(join(root, "src/styles"), { recursive: true });
  const b = new Bench(root, "atoms/x", join(tmp, "staging"));
  await b.start(config);
  // A warm graph: the watcher re-audits surgically from here on.
  await fetch(`${b.origin}/api/audit`);
  return b;
}
const findings = async (b: Bench) =>
  ((await (await fetch(`${b.origin}/api/audit`)).json()) as Audit).occurrences.filter(o => o.component === "atoms/x").map(o => o.ruleId);

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-reaudit-order-")); });
afterEach(() => { delete hooks.__testOnly_onReaudit; });
afterAll(async () => {
  await closeAll();
  for (const root of roots) await rm(pdScratchDir(root), { recursive: true, force: true });
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a template save, with the audit graph warm", () => {
  it("reloads the component only after its re-audit: the reload never comes before the new findings", async () => {
    const b = await project();
    expect(await findings(b)).toContain("element-permitted-content");
    let release = (): void => {};
    let engaged = (): void => {};
    const held = new Promise<void>(resolve => { engaged = resolve; });
    hooks.__testOnly_onReaudit = id => (id === "atoms/x" ? new Promise<void>(resolve => { engaged(); release = resolve; }) : undefined);

    const fromMsg = b.messages.length;
    const from = handled.length;
    await writeFile(b.at(FILE), `<button class="x">fine</button>\n`);
    await held;
    // The re-audit is running: no reload yet.
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(b.messages.slice(fromMsg)).not.toContain(SWAP);

    release();
    await whenHandled(() => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === FILE));
    await b.barrier();
    expect(b.messages.slice(fromMsg)).toContain(SWAP);
    // What the facet refetches on that reload: the findings after the save.
    expect(await findings(b)).toEqual([]);
  }, 60_000);

  it("reports a re-audit that fails, and reloads the component after the report", async () => {
    const b = await project();
    hooks.__testOnly_onReaudit = id => (id === "atoms/x" ? Promise.reject(new Error("forced for a test")) : undefined);
    const fromMsg = b.messages.length;
    const from = handled.length;
    await writeFile(b.at(FILE), `<button class="x">fine</button>\n`);
    await whenHandled(() => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === FILE));
    await b.barrier();
    const error = JSON.stringify({ type: "error", scope: "build", message: `${FILE} (change): its audit failed: forced for a test` });
    // In the order they were sent: the report, then the reload.
    expect(b.messages.slice(fromMsg).filter(m => m === error || m === SWAP)).toEqual([error, SWAP]);
  }, 60_000);
});
