// A linked pattern package (a `file:` dependency: a link in node_modules to a folder elsewhere) is used
// from its real folder everywhere: its pattern, style, theme, script, asset, data and helper roots, and
// the file paths discovery finds in it. An installed copy is said to be one at startup.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { startDevServer } from "@pattern-dump/dev-server";
import { loadPatternPackages } from "../src/packages.js";
import { resolveServerConfig } from "../src/server-config.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let project = "";
let real = "";

const MANIFEST = {
  patterns: "patterns", styles: { dir: "styles", documentBase: ["base"] }, themes: { dir: "themes" },
  scripts: "scripts", assets: ["assets/ds"], data: "data", helpers: "helpers/ds.js",
};

async function write(path: string, text: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await save(path, text);
}

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  packages: ["@acme/ds"],
});

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-real-paths-"));
  project = join(tmp, "site");
  real = join(project, "vendor", "ds");
  await write(join(real, "package.json"), JSON.stringify({ name: "@acme/ds", version: "1.0.0", patternDump: MANIFEST }));
  await write(join(real, "patterns", "atoms", "chip", "chip.hbs"), `<span class="chip">{{label}}</span>\n`);
  await write(join(real, "patterns", "atoms", "chip", "chip.json"), `{ "label": "Chip" }\n`);
  await write(join(real, "styles", "atoms", "chip.scss"), ".chip {\n  color: red;\n}\n");
  await write(join(real, "helpers", "ds.js"), "export function shout(s) { return String(s).toUpperCase(); }\n");
  await mkdir(join(project, "src", "patterns"), { recursive: true });
  await mkdir(join(project, "src", "styles"), { recursive: true });
  await mkdir(join(project, "node_modules", "@acme"), { recursive: true });
  await symlink(join("..", "..", "vendor", "ds"), join(project, "node_modules", "@acme", "ds"));
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("a linked package", () => {
  it("gives every root and every discovered file its real path", async () => {
    const r = realpathSync(real);
    const cfg = resolveServerConfig(validateConfig(config, "site"), project, {}, loadPatternPackages(config.packages, project));
    expect({
      patterns: cfg.patternRoots[1].dir, styles: cfg.styleRoots[1].dir, themes: cfg.themeDirs.at(-1),
      scripts: cfg.scriptsDirs.at(-1), assets: cfg.assetRoots.at(-1), data: cfg.dataDirs[0], helpers: cfg.helperPaths[0],
    }).toEqual({
      patterns: join(r, "patterns"), styles: join(r, "styles"), themes: join(r, "themes"),
      scripts: join(r, "scripts"), assets: join(r, "assets", "ds"), data: join(r, "data"), helpers: join(r, "helpers", "ds.js"),
    });
    const entry = (await buildDiscoveryMap(cfg.patternRoots)).discoveryMap.get("atoms/chip")!;
    expect([entry.hbsPath, entry.jsonPath]).toEqual([join(r, "patterns", "atoms", "chip", "chip.hbs"), join(r, "patterns", "atoms", "chip", "chip.json")]);
  });
});

describe("startup", () => {
  it("says a package is an installed copy, and says nothing more of a linked one it watches", async () => {
    const copy = join(tmp, "copy-site");
    const copied = join(copy, "node_modules", "@acme", "ds");
    await write(join(copied, "package.json"), JSON.stringify({ name: "@acme/ds", version: "1.0.0", patternDump: { patterns: "patterns" } }));
    await mkdir(join(copied, "patterns"), { recursive: true });
    await mkdir(join(copy, "src", "patterns"), { recursive: true });
    await mkdir(join(copy, "src", "styles"), { recursive: true });
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
    try {
      for (const root of [copy, project]) {
        const server = await startDevServer(validateConfig(config, "site"), root, { port: 0, wsPort: 0 });
        await server.close();
      }
    } finally {
      spy.mockRestore();
    }
    expect(lines.filter(l => l.includes("pattern package"))).toEqual([
      "[dev-server] pattern package @acme/ds@1.0.0: an installed copy, not watched",
      "[dev-server] pattern package @acme/ds@1.0.0",
    ]);
  }, 60_000);

  it("says a linked package with nothing to watch is not watched, without calling it a copy", async () => {
    const site = join(tmp, "empty-linked-site");
    const real = join(site, "vendor", "empty");
    await write(join(real, "package.json"), JSON.stringify({ name: "@acme/empty", version: "1.0.0", patternDump: {} }));
    await mkdir(join(site, "node_modules", "@acme"), { recursive: true });
    await symlink(join("..", "..", "vendor", "empty"), join(site, "node_modules", "@acme", "empty"));
    await mkdir(join(site, "src", "patterns"), { recursive: true });
    await mkdir(join(site, "src", "styles"), { recursive: true });
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
    try {
      const server = await startDevServer(validateConfig({ ...config, packages: ["@acme/empty"] }, "site"), site, { port: 0, wsPort: 0 });
      await server.close();
    } finally {
      spy.mockRestore();
    }
    expect(lines.filter(l => l.includes("pattern package"))).toEqual(["[dev-server] pattern package @acme/empty@1.0.0: linked, nothing in it to watch"]);
  }, 60_000);
});
