// pd build writes the project graph into the workbench snapshot (api/graph.json), the same JSON the live route serves,
// unless the config leaves it out with build.graph: false (a project whose structure shouldn't be published).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { PD_ROUTES, staticPathFor, type ProjectGraphJson } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let root = "";
const config = (build: PatternDumpConfig["build"] = {}): PatternDumpConfig => defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, build,
});
const exists = (path: string) => stat(path).then(() => true, () => false);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-build-graph-"));
  for (const [rel, body] of Object.entries({
    "src/patterns/atoms/button/button.hbs": `<button class="button">{{label}}</button>\n`,
    "src/patterns/molecules/card/card.hbs": `<div class="card"><div class="card-body">{{> atoms-button }}</div></div>\n`,
    "src/styles/atoms/button.scss": `.button { padding: 0; }\n`,
    "src/styles/molecules/card.scss": `.card { display: grid; }\n.card-body > .button { margin: 0; }\n`,
  })) await save(join(root, rel), body);
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("pd build and the project graph", () => {
  it("writes api/graph.json, the same JSON as the live route", async () => {
    const out = join(root, "with");
    await buildStaticSite(config(), root, { outDir: out, pdVersion: "0.0.0-test", audit: false });
    const written = await readFile(join(out, staticPathFor(PD_ROUTES.graph)), "utf8");
    const graph = JSON.parse(written) as ProjectGraphJson;
    expect(graph.edges).toContainEqual(expect.objectContaining({ kind: "mentions", from: "stylesheet:src/styles/molecules/card.scss", to: "class:button" }));
    const server = await startDevServer(config(), root, { port: 0, wsPort: 0 });
    try {
      expect(written).toBe(await (await fetch(`http://127.0.0.1:${server.port}${PD_ROUTES.graph}`)).text());
    } finally { await server.close(); }
  }, 120_000);

  it("leaves it out with build.graph: false", async () => {
    const out = join(root, "without");
    const lines: string[] = [];
    await buildStaticSite(config({ graph: false }), root, { outDir: out, pdVersion: "0.0.0-test", audit: false, log: l => lines.push(l) });
    expect(await exists(join(out, staticPathFor(PD_ROUTES.graph)))).toBe(false);
    expect(await exists(join(out, staticPathFor(PD_ROUTES.tree)))).toBe(true);
    expect(lines.join("\n")).toContain("project graph left out (build.graph: false)");
  }, 120_000);
});
