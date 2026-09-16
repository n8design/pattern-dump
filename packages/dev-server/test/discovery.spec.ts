import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";

const here      = dirname(fileURLToPath(import.meta.url));
const testBench = join(here, "../../../test-bench");

const config = defineConfig({
  sourceDir:   "./src",
  patternsDir: "./src/patterns",
  outDir:      "./dist",
  styles:      { strategy: "parallel", dir: "./src/styles" },
  themes:      { dir: "./themes", default: "light", switch: "attribute" },
  assets:      { strategy: "central", dir: "./assets" },
  scriptsDir:  "./src/scripts",
});

// The 18 folder-per-component slash ids in the committed test-bench corpus.
// Regression gate: every id must survive the M6 discovery rewrite byte-identical.
//
// Asserting HTTP 200 alone is a false-green — a wrong-file resolution (wrong hbsPath in the
// discovery map) can still return 200. Each assertion checks THREE things:
//   1. HTTP 200  — the route exists
//   2. detail.id === id  — the component identity is preserved (not remapped)
//   3. detail.source.hbs is non-empty  — the .hbs file was actually read (not a silent miss)
const GOLDEN_IDS = [
  "atoms/a11y-invalid",
  "atoms/broken-template",
  "atoms/button",
  "atoms/contrast-fail",
  "atoms/font-demo",
  "atoms/html-invalid",
  "atoms/icon",
  "atoms/input",
  "atoms/schema-guard",
  "atoms/symbol-demo",
  "atoms/toggle-demo",
  "atoms/white-noise",
  "molecules/field",
  "molecules/media",
  "organisms/buttonbar",
  "organisms/card",
  "organisms/toolbar",
  "pages/homepage",
] as const;

describe("discovery collapse-rule regression — committed corpus (18 ids)", () => {
  let server: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startDevServer(config, testBench, { port: 0, wsPort: 0 });
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  for (const id of GOLDEN_IDS) {
    it(`${id}: id preserved + .hbs file read`, async () => {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/component/${id}`);
      expect(res.status, `HTTP status for ${id}`).toBe(200);
      const detail = await res.json() as { id: string; source: { hbs: string } };
      expect(detail.id, `id field for ${id}`).toBe(id);
      expect(detail.source?.hbs, `source.hbs non-empty for ${id}`).toBeTruthy();
    });
  }
});

// ---- M6 new-capability standing tests ----
// These lock the capabilities added in M6 so a future refactor that reintroduces the limiter
// turns a test red before it reaches main. Structure mirrors the five live probe checks.

type TreeNode = { path: string; kind: string; children?: TreeNode[] };

function flattenTree(roots: TreeNode[]): string[] {
  const paths: string[] = [];
  function walk(ns: TreeNode[]) {
    for (const n of ns) { paths.push(n.path); if (n.children) walk(n.children); }
  }
  walk(roots);
  return paths;
}

describe("M6 new capability — flat, grouped, collision, variants", () => {
  let server: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startDevServer(config, testBench, { port: 0, wsPort: 0 });
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  // ---- Flat ----

  it("atoms/anotherentry: flat file resolves — id correct, non-empty source.hbs", async () => {
    const res  = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/anotherentry`);
    expect(res.status).toBe(200);
    const d = await res.json() as { id: string; source: { hbs: string } };
    expect(d.id).toBe("atoms/anotherentry");
    expect(d.source?.hbs).toBeTruthy();
  });

  // ---- Grouped (folder ≠ component name) ----

  it("atoms/widgets/spinner: grouped component resolves (folder widgets ≠ component spinner)", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/widgets/spinner`);
    expect(res.status).toBe(200);
    const d = await res.json() as { id: string; source: { hbs: string } };
    expect(d.id).toBe("atoms/widgets/spinner");
    expect(d.source?.hbs).toBeTruthy();
  });

  it("atoms/widgets/spinner: appears in nav tree under atoms/widgets group", async () => {
    const res  = await fetch(`http://127.0.0.1:${server.port}/api/tree`);
    const tree = await res.json() as { roots: TreeNode[] };
    const paths = flattenTree(tree.roots);
    expect(paths).toContain("atoms/widgets/spinner");
    expect(paths).toContain("atoms/widgets"); // group node present
  });

  // ---- Collision ----

  it("collision: atoms/baseless-2 is incumbent — owns handle atoms-baseless-2", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/baseless-2`);
    expect(res.status).toBe(200);
    const d = await res.json() as { id: string; source: { hbs: string } };
    expect(d.id).toBe("atoms/baseless-2");
    expect(d.source?.hbs).toBeTruthy(); // real file was read
  });

  it("collision: atoms/baseless/baseless-2 is quarantined — absent from tree", async () => {
    const res  = await fetch(`http://127.0.0.1:${server.port}/api/tree`);
    const tree = await res.json() as { roots: TreeNode[] };
    const paths = flattenTree(tree.roots);
    expect(paths).not.toContain("atoms/baseless/baseless-2"); // quarantined, not in tree
    expect(paths).toContain("atoms/baseless-2");              // incumbent IS in tree
  });

  it("collision: quarantined detail returns 200 with HANDLE_COLLISION diagnostic naming both sides", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/baseless/baseless-2`);
    expect(res.status).toBe(200);
    const d = await res.json() as {
      id: string;
      diagnostics: { kind: string; message: string }[];
    };
    expect(d.id).toBe("atoms/baseless/baseless-2");
    const diag = d.diagnostics.find(x => x.kind === "HANDLE_COLLISION");
    expect(diag, "HANDLE_COLLISION diagnostic present").toBeTruthy();
    expect(diag?.message).toContain("atoms/baseless-2"); // incumbent named
    expect(diag?.message).toContain("atoms-baseless-2"); // handle named
  });

  // ---- Variants ----

  it("chip~save: own-markup variant resolves — own .hbs template used", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/chip?variant=save`);
    expect(res.status).toBe(200);
    const d = await res.json() as { id: string; document: string; diagnostics: { kind: string }[] };
    expect(d.id).toBe("atoms/chip");
    expect(d.document).toContain("pd-chip--save"); // chip~save.hbs uses own markup
    expect(d.diagnostics.some(x => x.kind === "RENDER_ERROR")).toBe(false);
  });

  it("chip~danger: data-overlay variant resolves — chip.hbs + danger data", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/chip?variant=danger`);
    expect(res.status).toBe(200);
    const d = await res.json() as { id: string; document: string; diagnostics: { kind: string }[] };
    expect(d.id).toBe("atoms/chip");
    expect(d.document).toContain("Danger Chip"); // chip~danger.json data overlaid on chip.hbs
    expect(d.diagnostics.some(x => x.kind === "RENDER_ERROR")).toBe(false);
  });

  it("badge: synthesized base node — ownMarkup:false, empty hbs, variants [info, warning]", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/badge`);
    expect(res.status).toBe(200);
    const d = await res.json() as {
      id: string;
      source: { hbs: string };
      variants: { name: string }[];
    };
    expect(d.id).toBe("atoms/badge");
    expect(d.source?.hbs).toBe(""); // no base .hbs on disk — base-less synthesis
    expect(d.variants.map(v => v.name).sort()).toEqual(["info", "warning"]);
  });

  it("badge~info: base-less variant resolves — ~ preserved in id/handle/route", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/badge~info`);
    expect(res.status).toBe(200);
    const d = await res.json() as { id: string; document: string; diagnostics: { kind: string }[] };
    expect(d.id).toBe("atoms/badge~info"); // ~ in id
    expect(d.document).toContain("pd-badge--info");
    expect(d.diagnostics.some(x => x.kind === "RENDER_ERROR")).toBe(false);
  });

  it("badge~warning: base-less variant resolves", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/badge~warning`);
    expect(res.status).toBe(200);
    const d = await res.json() as { id: string; document: string; diagnostics: { kind: string }[] };
    expect(d.id).toBe("atoms/badge~warning");
    expect(d.document).toContain("pd-badge--warning");
    expect(d.diagnostics.some(x => x.kind === "RENDER_ERROR")).toBe(false);
  });

  // ---- Composition edge (quoted partial regex guard) ----

  it("spinner uses atoms/badge~info — {{> \"atoms-badge~info\"}} resolves as composition edge", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/widgets/spinner`);
    expect(res.status).toBe(200);
    const d = await res.json() as {
      id: string;
      document: string;
      relationships: { uses: string[] };
      diagnostics: { kind: string }[];
    };
    expect(d.id).toBe("atoms/widgets/spinner");
    expect(d.relationships.uses).toContain("atoms/badge~info"); // ~ in composition edge
    expect(d.document).toContain("pd-badge--info"); // partial was rendered
    expect(d.diagnostics.some(x => x.kind === "RENDER_ERROR")).toBe(false);
  });

  // ---- Collapsed base group reconciliation ----
  // baseless-2/ holds baseless-2.hbs (collapses to atoms/baseless-2) AND baseless-3.hbs
  // (id: atoms/baseless-2/baseless-3). buildTreeNodeFromMap merges them into one node via
  // directChildPaths dedup — the collapsed-base IS the group. Guard against regressions that
  // split them into two clashing atoms-level entries.

  it("baseless-2: collapsed-base folder with sibling is one merged group — both members as parent/child", async () => {
    const res  = await fetch(`http://127.0.0.1:${server.port}/api/tree`);
    const tree = await res.json() as { roots: TreeNode[] };
    const paths = flattenTree(tree.roots);

    expect(paths).toContain("atoms/baseless-2");
    expect(paths).toContain("atoms/baseless-2/baseless-3");
    // exactly one node — not duplicated as both component AND folder
    expect(paths.filter(p => p === "atoms/baseless-2")).toHaveLength(1);

    const atomsNode = tree.roots.find(r => r.path === "atoms");
    const b2 = atomsNode?.children?.find(n => n.path === "atoms/baseless-2");
    expect(b2, "atoms/baseless-2 node present under atoms").toBeTruthy();
    // baseless-3 is a child of baseless-2, not a sibling at the atoms level
    expect(b2?.children?.map(c => c.path)).toContain("atoms/baseless-2/baseless-3");
    expect(atomsNode?.children?.map(c => c.path)).not.toContain("atoms/baseless-2/baseless-3");
  });

  it("baseless-2: collapsed-base node is kind:component (own .hbs on disk via collapse rule)", async () => {
    const res  = await fetch(`http://127.0.0.1:${server.port}/api/tree`);
    const tree = await res.json() as { roots: TreeNode[] };
    const atomsNode = tree.roots.find(r => r.path === "atoms");
    const b2 = atomsNode?.children?.find(n => n.path === "atoms/baseless-2");
    expect(b2?.kind).toBe("component");
  });
});
