// `pd audit` fails (exit code 1) when it finds an error, as pd build fails on its checks' errors; warnings alone leave
// it at 0, and --strict makes any finding fail it. Its last line says why. It used to exit 0 whatever it found, so a CI
// step running it never failed. Runs the built binary on small projects in a temp folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { save } from "../../../test-support/save.js";

const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url));
let tmp = "";
let n = 0;
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-audit-exit-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

/** A project with `templates` (path under the patterns folder → template). */
async function project(templates: Record<string, string>): Promise<string> {
  const root = join(tmp, `p-${n++}`);
  await save(join(root, "pattern-dump.config.json"), JSON.stringify({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" },
  }));
  await save(join(root, "src/styles/.keep"), "");
  for (const [rel, text] of Object.entries(templates)) await save(join(root, "src/patterns", rel), text);
  return root;
}

function audit(root: string, ...args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, "audit", "--root", root, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", c => { out += c; });
    child.stderr.setEncoding("utf8").on("data", c => { out += c; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, out }));
  });
}
const lastLine = (out: string) => out.trim().split("\n").at(-1);

const CLEAN = { "atoms/ok/ok.hbs": `<p>fine</p>\n` };
/** html-validate refuses a <div> in a <span>: a warning. */
const WARNING = { "atoms/odd/odd.hbs": `<span><div>odd</div></span>\n` };
/** A helper nobody registered: the render fails, an error. */
const ERROR = { "atoms/broken/broken.hbs": `<p>{{nope "x"}}</p>\n` };
/** A partial whose sample file doesn't parse, included by another component. Pages no longer read sample data
 *  (0.8.1), so the site build doesn't report it; pd audit still must, as an error. */
const BROKEN_SAMPLE = {
  "atoms/price/price.hbs": `<span>{{amount}}</span>\n`,
  "atoms/price/price.json": `{ "amount": 61.40,\n}\n`,
  "molecules/card/card.hbs": `<div>{{> atoms-price }}</div>\n`,
};

describe("pd audit's exit code", () => {
  it("is 0 when it finds nothing", async () => {
    const r = await audit(await project(CLEAN));
    expect(r.code).toBe(0);
  }, 120_000);

  it("is 0 for warnings alone, and 1 for them with --strict, which the last line says", async () => {
    const root = await project({ ...CLEAN, ...WARNING });
    expect((await audit(root)).code).toBe(0);
    const strict = await audit(root, "--strict");
    expect(strict.code).toBe(1);
    expect(lastLine(strict.out)).toBe("[pd audit] failed: 1 defect found, with --strict (a warning fails it too).");
  }, 120_000);

  it("is 1 for an error, which the last line says", async () => {
    const r = await audit(await project({ ...CLEAN, ...WARNING, ...ERROR }));
    expect(r.code).toBe(1);
    expect(lastLine(r.out)).toBe("[pd audit] failed: 1 error found (warnings alone don't fail it; --strict makes them fail it too).");
  }, 120_000);

  it("is 1 for a partial's sample file that isn't valid JSON, reported as DATA_INVALID", async () => {
    const root = await project({ ...CLEAN, ...BROKEN_SAMPLE });
    const r = await audit(root);
    expect(r.code).toBe(1);
    // Reported on the partial and on the component that includes it: two errors.
    expect(r.out).toMatch(/### atoms\/price[^\n]*\n- `render:DATA_INVALID`[^\n]*price\.json is not valid JSON/);
    expect(r.out).toMatch(/### molecules\/card[^\n]*\n- `render:DATA_INVALID`[^\n]*price\.json is not valid JSON/);
    expect(lastLine(r.out)).toBe("[pd audit] failed: 2 errors found (warnings alone don't fail it; --strict makes them fail it too).");
  }, 120_000);

  it("is 1 for an error with --format json too, whose standard output stays the JSON report", async () => {
    const root = await project({ ...CLEAN, ...ERROR });
    const r = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, "audit", "--root", root, "--format", "json"], { stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      child.stdout.setEncoding("utf8").on("data", c => { stdout += c; });
      child.on("error", reject);
      child.on("close", code => resolve({ code, stdout }));
    });
    expect(r.code).toBe(1);
    expect(() => JSON.parse(r.stdout) as unknown).not.toThrow();
  }, 120_000);
});
