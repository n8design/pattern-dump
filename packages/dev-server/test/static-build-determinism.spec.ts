// A static build with a fixed clock is reproducible: two builds of an unchanged project are
// byte-identical, file for file. Without one, the snapshot carries the real build time, as before.
//
// The three time stamps a snapshot carries are the shell's `builtAt` (every route's index.html), the
// audit's `generatedAt` (api/audit.json) and the server's `startedAt` (api/version.json). They are the
// only differences between two plain builds; this pins that all three follow the clock.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";

const testBench = fileURLToPath(new URL("../../../test-bench/", import.meta.url));
const FIXED = new Date("2026-01-02T03:04:05.000Z");

// test-bench's own config, inline (as static-build.spec.ts does): a dev-server test does not load
// configs through core, which sits above this package.
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  themes: { dir: "./themes", default: "light", switch: "attribute" },
  assets: { strategy: "central", dir: "./assets" },
  scriptsDir: "./src/scripts",
  helpers: "./src/helpers",
  dataDir: "./src/_data",
  packages: ["pd-fixture-ui"],
});

let tmp = "";

async function tree(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.set(relative(dir, p), await readFile(p));
    }
  };
  await walk(dir);
  return out;
}

const build = (name: string, now?: Date) =>
  buildStaticSite(config, testBench, { outDir: join(tmp, name), basePath: "/pd/", pdVersion: "0.0.0-test", ...(now ? { now } : {}) });

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-static-determinism-"));
  await build("a", FIXED);
  await build("b", FIXED);
  await build("real");
}, 180_000);

afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("pd build with a fixed clock", () => {
  it("writes byte-identical snapshots on two runs", async () => {
    const [a, b] = await Promise.all([tree(join(tmp, "a")), tree(join(tmp, "b"))]);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    const differing = [...a].filter(([path, bytes]) => !bytes.equals(b.get(path)!)).map(([path]) => path);
    expect(differing).toEqual([]);
    expect(a.size).toBeGreaterThan(300);
  });

  it("takes every time stamp from the clock", async () => {
    const iso = FIXED.toISOString();
    const shell = await readFile(join(tmp, "a", "index.html"), "utf8");
    expect(shell).toContain(`"builtAt":"${iso}"`);
    const audit = JSON.parse(await readFile(join(tmp, "a", "api", "audit.json"), "utf8")) as { generatedAt: string };
    expect(audit.generatedAt).toBe(iso);
    const version = JSON.parse(await readFile(join(tmp, "a", "api", "version.json"), "utf8")) as { startedAt: string };
    expect(version.startedAt).toBe(iso);
  });
});

describe("pd build without a clock", () => {
  it("stamps the real build time, as before", async () => {
    const started = Date.now() - 180_000;
    const shell = await readFile(join(tmp, "real", "index.html"), "utf8");
    const builtAt = /"builtAt":"([^"]+)"/.exec(shell)?.[1];
    expect(builtAt).toBeDefined();
    expect(Date.parse(builtAt!)).toBeGreaterThan(started);
    expect(builtAt).not.toBe(FIXED.toISOString());
    const audit = JSON.parse(await readFile(join(tmp, "real", "api", "audit.json"), "utf8")) as { generatedAt: string };
    expect(Date.parse(audit.generatedAt)).toBeGreaterThan(started);
  });
});
