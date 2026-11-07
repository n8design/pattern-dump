// A pattern package ships compiled helpers: a manifest naming a TypeScript helper file, or a helpers
// folder holding TypeScript and no .js, stops startup with an error that says so, in pd dev, pd audit
// and pd build alike. The project's own helpers may still be TypeScript.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildStaticSite, runDiagnosticsAudit, startDevServer } from "@pattern-dump/dev-server";
import { loadPatternPackages } from "../src/packages.js";
import { loadHelperRegistrars } from "../src/project-loaders.js";

let tmp = "";
let n = 0;

async function write(path: string, text: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

/** A project with one installed package whose manifest names `helpers`, and the files given. */
async function project(helpers: string, files: Record<string, string>): Promise<string> {
  const root = join(tmp, `p${n++}`);
  const dir = join(root, "node_modules", "@acme", "ds");
  await write(join(dir, "package.json"), JSON.stringify({ name: "@acme/ds", version: "1.0.0", patternDump: { patterns: "patterns", helpers } }));
  await mkdir(join(dir, "patterns"), { recursive: true });
  for (const [rel, text] of Object.entries(files)) await write(join(dir, rel), text);
  await mkdir(join(root, "src", "patterns"), { recursive: true });
  await mkdir(join(root, "src", "styles"), { recursive: true });
  return root;
}

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  packages: ["@acme/ds"],
});
const FIX = `Ship compiled helpers: build .js from the TypeScript source and name the .js in "patternDump.helpers".`;
const TS_FILE = `pattern package "@acme/ds": its helpers are TypeScript (helpers/ds.ts), which Node does not load from an installed package. ${FIX}`;
const TS_FOLDER = `pattern package "@acme/ds": its helpers folder (helpers) holds TypeScript and no .js, which Node does not load from an installed package. ${FIX}`;

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-package-helpers-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("a package's helpers", () => {
  it("named as a TypeScript file stop startup, saying to ship compiled helpers", async () => {
    const root = await project("helpers/ds.ts", { "helpers/ds.ts": "export const shout = (s: string) => s;\n" });
    expect(() => loadPatternPackages(["@acme/ds"], root)).toThrow(TS_FILE);
    for (const ext of ["mts", "cts"]) {
      const other = await project(`helpers/ds.${ext}`, {});
      expect(() => loadPatternPackages(["@acme/ds"], other)).toThrow(`its helpers are TypeScript (helpers/ds.${ext})`);
    }
  });

  it("in a folder of TypeScript only stop startup too", async () => {
    const root = await project("helpers", { "helpers/a.ts": "export const a = 1;\n", "helpers/b.mts": "export const b = 1;\n" });
    expect(() => loadPatternPackages(["@acme/ds"], root)).toThrow(TS_FOLDER);
  });

  it("load when compiled: a .js file, or a folder that has .js beside its sources", async () => {
    const file = await project("dist/ds.js", { "dist/ds.js": "export const shout = s => s;\n" });
    const mixed = await project("helpers", { "helpers/ds.ts": "export const x = 1;\n", "helpers/ds.js": "export const x = 1;\n" });
    for (const root of [file, mixed]) expect(loadPatternPackages(["@acme/ds"], root).map(p => p.name)).toEqual(["@acme/ds"]);
  });

  it("stop pd dev, pd audit and pd build with the same error", async () => {
    const root = await project("helpers/ds.ts", { "helpers/ds.ts": "export const shout = (s: string) => s;\n" });
    const cfg = validateConfig(config, "p");
    await expect(startDevServer(cfg, root, { port: 0, live: false })).rejects.toThrow(TS_FILE);
    await expect(runDiagnosticsAudit(cfg, root)).rejects.toThrow(TS_FILE);
    await expect(buildStaticSite(cfg, root, { outDir: join(root, "site"), pdVersion: "0.0.0-test" })).rejects.toThrow(TS_FILE);
  });
});

describe("a package helpers folder with .js and .ts files", () => {
  it("loads the .js and warns at startup, naming the TypeScript files it skips", async () => {
    const root = await project("helpers", {
      "helpers/shout.js": "export function shout(s) { return String(s).toUpperCase(); }\n",
      "helpers/shout.ts": "export function shout(s: string): string { return s.toUpperCase(); }\n",
      "helpers/whisper.mts": "export const whisper = (s: string): string => s;\n",
    });
    const warnings: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { warnings.push(a.join(" ")); });
    let dir = "";
    try {
      dir = loadPatternPackages(["@acme/ds"], root)[0].dir;
    } finally {
      spy.mockRestore();
    }
    expect(warnings).toEqual([`[dev-server] pattern package "@acme/ds": helpers folder helpers loads its .js files; skipped TypeScript: shout.ts, whisper.mts`]);
    const names: string[] = [];
    for (const register of await loadHelperRegistrars(join(dir, "helpers"))) register({ registerHelper: (name: string) => names.push(name) });
    expect(names).toEqual(["shout"]);
  });

  it("warns about nothing when the folder holds only .js", async () => {
    const root = await project("helpers", { "helpers/shout.js": "export function shout(s) { return s; }\n" });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      loadPatternPackages(["@acme/ds"], root);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the project's own helpers", () => {
  it("may be TypeScript", async () => {
    const root = join(tmp, "own");
    await write(join(root, "src", "helpers", "shout.ts"), "export function shout(s: string): string { return s.toUpperCase(); }\n");
    await write(join(root, "src", "patterns", "atoms", "loud", "loud.hbs"), `<p class="loud">{{shout "quiet"}}</p>\n`);
    await mkdir(join(root, "src", "styles"), { recursive: true });
    const own = validateConfig(defineConfig({
      sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
      styles: { strategy: "parallel", dir: "./src/styles" }, helpers: "./src/helpers/shout.ts",
    }), "own");
    const server = await startDevServer(own, root, { port: 0, live: false });
    try {
      const html = await (await fetch(`http://127.0.0.1:${server.port}/preview/atoms/loud`)).text();
      expect(html).toContain(`<p class="loud">QUIET</p>`);
    } finally {
      await server.close();
    }
  }, 60_000);
});
