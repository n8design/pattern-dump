// Which pages the graph has: pd dev's graph, and pd graph / pd describe / pd affected (readProjectGraph), read the
// site as pd dev shows it, drafts in, so an agent working on a draft sees it; pd build's graph.json leaves drafts out,
// as the published site does. On a copy of storefront-bench with one draft page that places a component.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { PD_ROUTES, staticPathFor, type ProjectGraphJson } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer } from "@pattern-dump/dev-server";
import { graphJson } from "../src/graph/build.js";
import { readProjectGraph } from "../src/graph/project.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const config = validateConfig(benchConfig, "storefront-bench");
let root = "";

beforeAll(async () => {
  root = join(await mkdtemp(join(tmpdir(), "pd-graph-drafts-")), "bench");
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  await save(join(root, "pages/draft-note.md"),
    `---\ntitle: A draft\ndescription: Not published yet.\ndraft: true\n---\n\n<pd-components-icon-label label="Draft"></pd-components-icon-label>\n`);
}, 60_000);
afterAll(async () => { if (root) await rm(dirname(root), { recursive: true, force: true }); });

const hasDraft = (g: ProjectGraphJson): boolean => g.nodes.some(n => n.id === "page:/draft-note/");

describe("drafts in the project graph", () => {
  it("pd graph (readProjectGraph) has them, as pd dev does", async () => {
    const read = graphJson((await readProjectGraph(config, root)).graph);
    expect(hasDraft(read)).toBe(true);
    expect(read.edges).toContainEqual(expect.objectContaining({ kind: "places", from: "page:/draft-note/", to: "component:components/icon-label" }));
    const server = await startDevServer(config, root, { port: 0, wsPort: 0 });
    try {
      expect(hasDraft(await (await fetch(`http://127.0.0.1:${server.port}${PD_ROUTES.graph}`)).json() as ProjectGraphJson)).toBe(true);
    } finally { await server.close(); }
  }, 60_000);

  it("pd build's graph.json leaves them out", async () => {
    const out = join(dirname(root), "out");
    await buildStaticSite(config, root, { outDir: out, pdVersion: "0.0.0-test", audit: false });
    const built = JSON.parse(await readFile(join(out, staticPathFor(PD_ROUTES.graph)), "utf8")) as ProjectGraphJson;
    expect(hasDraft(built)).toBe(false);
    expect(built.nodes.some(n => n.id === "page:/about/")).toBe(true);
  }, 180_000);
});
