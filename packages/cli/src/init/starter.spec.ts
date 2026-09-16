// The shipped starter, held to the bar a new project deserves: it scaffolds, boots, renders every
// component without a diagnostic, and audits with ZERO defects. The teaching set shows how Pattern
// Dump works — not what it catches.
//
// Scaffolded INSIDE this package (not the OS tmpdir) so the generated config's import resolves:
// the config is bundled by esbuild from its own location, and here it imports the in-repo
// @pattern-dump/config instead of the not-yet-installed distributable.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ComponentDetailResponse, ComponentTree, TreeNode } from "@pattern-dump/contracts";
import { loadConfig } from "@pattern-dump/core";
import { runDiagnosticsAudit, startDevServer } from "@pattern-dump/dev-server";
import { applyPlan, readTemplates } from "./files.js";
import { planInit } from "./plan.js";

const cliDir = fileURLToPath(new URL("../../", import.meta.url));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
let dir = "";
let bareDir = "";

async function scaffold(examples: boolean): Promise<string> {
  const target = await mkdtemp(join(cliDir, ".test-scaffold-"));
  const templates = await readTemplates(join(cliDir, "templates"));
  const r = planInit(
    templates,
    { name: "starter-check", brand: "Starter Check", examples, dependency: "^0.0.0" },
    { packageJson: null, exists: () => false },
    "@pattern-dump/config",
  );
  if (!r.ok) throw new Error(r.reason);
  await applyPlan(target, r.plan);
  return target;
}

/** `tsc --noEmit` against the scaffold's own tsconfig — what `npm run typecheck` runs. */
const typecheck = (project: string) =>
  promisify(execFile)(process.execPath, [tsc, "--noEmit", "-p", project]).then(
    () => ({ code: 0, output: "" }),
    (e: { code?: number; stdout?: string }) => ({ code: e.code ?? 1, output: e.stdout ?? "" }),
  );

beforeAll(async () => {
  dir = await scaffold(true);
  bareDir = await scaffold(false);
}, 60_000);

afterAll(async () => {
  for (const d of [dir, bareDir]) if (d) await rm(d, { recursive: true, force: true });
});

const components = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap(n => [...(n.kind === "component" ? [n] : []), ...components(n.children ?? [])]);

describe("the starter project", () => {
  it("brands the shell with the chosen title", async () => {
    expect(await readFile(join(dir, "pattern-dump.config.ts"), "utf8")).toContain('title: "Starter Check"');
  });

  it("audits with zero static defects, and every component renders", async () => {
    const config = await loadConfig(dir);
    const { graph } = await runDiagnosticsAudit(config, dir);
    expect(graph.occurrences).toEqual([]);
    expect(graph.components.map(c => [c.id, c.render])).toEqual(
      graph.components.map(c => [c.id, "ok"]),
    );
    expect(graph.components.map(c => c.id).sort()).toEqual([
      "atoms/button", "molecules/search-field", "molecules/search-field/input", "pages/example",
    ]);
  }, 120_000);

  it("boots, shows the teaching set in order, and every component and variant is diagnostic-free", async () => {
    const config = await loadConfig(dir);
    const server = await startDevServer(config, dir, { port: 0, wsPort: 0 });
    try {
      const get = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);
      const tree = await (await get("/api/tree")).json() as ComponentTree;
      expect(tree.roots.map(r => [r.path, r.title, r.hasOverview])).toEqual([
        ["atoms", "Atoms", true], ["molecules", "Molecules", true], ["pages", "Pages", true],
      ]);
      expect(components(tree.roots).find(c => c.path === "molecules/search-field/input")?.visibility).toBe("private");

      for (const [id, variant] of [
        ["atoms/button"], ["atoms/button", "secondary"], ["atoms/button", "icon"],
        ["molecules/search-field"], ["molecules/search-field/input"], ["pages/example"],
      ] as Array<[string, string?]>) {
        const d = await (await get(`/api/component/${id}${variant ? `?variant=${variant}` : ""}`)).json() as ComponentDetailResponse;
        expect(d.diagnostics, `${id}${variant ? `~${variant}` : ""}`).toEqual([]);
      }

      const search = await (await get("/api/component/molecules/search-field")).json() as ComponentDetailResponse;
      expect(search.relationships.uses.sort()).toEqual(["atoms/button", "molecules/search-field/input"]);

      // Behaviour: the search field's script is required by the component, reaches every preview that
      // shows one (the example page includes it), and compiles.
      for (const id of ["molecules/search-field", "pages/example"]) {
        const d = await (await get(`/api/component/${id}`)).json() as ComponentDetailResponse;
        expect(d.document, id).toMatch(/<script type="module" src="\/_pd\/scripts\/search-field\.js[?"]/);
      }
      const script = await get("/_pd/scripts/search-field.js");
      expect(script.status).toBe(200);
      expect(script.headers.get("content-type")).toContain("javascript");
      const js = await script.text();
      expect(js).toContain("form.search-field");
      expect(js).not.toContain("HTMLFormElement>"); // types stripped

      const themes = await (await get("/api/themes")).json() as Array<{ name: string; tokens?: Record<string, string | null> }>;
      expect(themes.map(t => t.name).sort()).toEqual(["dark", "light"]);
      for (const t of themes) expect(Object.values(t.tokens ?? {}).every(v => v !== null), t.name).toBe(true);
    } finally {
      await server.close();
    }
  }, 120_000);

  it("type-checks with its own tsconfig", async () => {
    expect(await typecheck(dir)).toEqual({ code: 0, output: "" });
  }, 60_000);

  it("type-checks without the examples too (src/scripts is never empty)", async () => {
    expect(await typecheck(bareDir)).toEqual({ code: 0, output: "" });
  }, 60_000);
});
