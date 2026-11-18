// Component and folder metadata comes from the leading `---` block only.
//
// The per-key reads used to match `^key:` anywhere in the file, so a body line such as `requireScript: x`
// in a code sample loaded a script, and a quoted value kept its quotes. Each reader is pinned here: the
// tree (title, status, visibility, a folder's title, visibility and overview), the detail (title,
// description, status, deprecated-use), the preview layout (`preview:`) and requires (requireScript,
// requireAssets). Fixtures are throwaway, as in layout-mode.spec.ts.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TreeNode } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { buildComponentTree } from "../src/component-tree.js";
import { buildComponentDetail } from "../src/detail.js";
import { resolveLayoutMode } from "../src/layout-mode.js";
import { buildFolderOverview } from "../src/overview.js";
import { aggregateRequires } from "../src/requires.js";
import { save } from "../../../test-support/save.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function patterns(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pd-meta-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  return root;
}

function find(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.path === path) return n;
    const hit = find(n.children ?? [], path);
    if (hit) return hit;
  }
  return undefined;
}

/** Every metadata key, written in the body of a file whose frontmatter sets none of them. */
const BODY_ONLY = [
  "---", "order: 0", "---", "",
  "A code sample in the docs:", "",
  "title: Body title",
  "status: stable",
  "visibility: private",
  "description: Body description",
  "deprecated-use: atoms/other",
  "preview: full",
  "requireScript: body-script",
  "requireAssets: body-icons",
  "overview: false",
  "",
].join("\n");

/** The same keys with no frontmatter block at all: nothing is read. */
const NO_BLOCK = ["title: Unfenced", "status: stable", "visibility: private", "requireScript: loose", ""].join("\n");

const noRender = async () => ({ html: "" });

describe("metadata outside the frontmatter block is not read", () => {
  it("tree: a component's title, status and visibility", async () => {
    const dir = await patterns({
      "atoms/chip/chip.hbs": "<span>c</span>",
      "atoms/chip/chip.md": BODY_ONLY,
      "atoms/tag/tag.hbs": "<span>t</span>",
      "atoms/tag/tag.md": NO_BLOCK,
    });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const tree = await buildComponentTree(dir, true, discoveryMap);
    for (const id of ["atoms/chip", "atoms/tag"]) {
      const node = find(tree.roots, id)!;
      expect(node.title).toBe(id.split("/")[1]);
      expect(node.status).toBe("draft");
      expect(node.visibility).toBeUndefined();
    }
  });

  it("tree: a folder's title, visibility and overview", async () => {
    const dir = await patterns({
      "atoms/index.md": BODY_ONLY,
      "atoms/chip/chip.hbs": "<span>c</span>",
    });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const tree = await buildComponentTree(dir, true, discoveryMap);
    const folder = find(tree.roots, "atoms")!;
    expect(folder.title).toBe("Atoms");
    expect(folder.visibility).toBeUndefined();
    expect(folder.hasOverview).toBe(true);
  });

  it("detail: title, description, status and deprecated-use", async () => {
    const dir = await patterns({ "atoms/chip/chip.hbs": "<span>c</span>", "atoms/chip/chip.md": BODY_ONLY });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const detail = await buildComponentDetail("atoms/chip", dir, noRender, { css: "" }, undefined, new Map(), undefined, undefined, undefined, discoveryMap);
    expect(detail.title).toBe("chip");
    expect(detail.description).toBe("");
    expect(detail.status).toBe("draft");
    expect(detail.deprecatedUse).toBeUndefined();
  });

  it("preview layout: a component's and its category's `preview:`", async () => {
    const dir = await patterns({
      "atoms/index.md": BODY_ONLY,
      "atoms/chip/chip.hbs": "<span>c</span>",
      "molecules/card/card.hbs": "<div>c</div>",
      "molecules/card/card.md": BODY_ONLY,
    });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    expect(await resolveLayoutMode("atoms/chip", dir, discoveryMap)).toBe("centered");
    expect(await resolveLayoutMode("molecules/card", dir, discoveryMap)).toBe("centered");
    expect((await buildFolderOverview("atoms", dir, noRender, discoveryMap)).layout).toBe("centered");
  });

  it("requires: requireScript and requireAssets", async () => {
    const dir = await patterns({
      "atoms/chip/chip.hbs": "<span>c</span>",
      "atoms/chip/chip.md": BODY_ONLY,
      "atoms/tag/tag.hbs": "<span>t</span>",
      "atoms/tag/tag.md": NO_BLOCK,
    });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    expect(await aggregateRequires("atoms/chip", dir, new Map(), discoveryMap)).toEqual({ scripts: [], assets: [] });
    expect(await aggregateRequires("atoms/tag", dir, new Map(), discoveryMap)).toEqual({ scripts: [], assets: [] });
  });
});

describe("metadata in the frontmatter block is read as frontmatter", () => {
  it("quoted values lose their quotes", async () => {
    const dir = await patterns({
      "atoms/chip/chip.hbs": "<span>c</span>",
      "atoms/chip/chip.md": ['---', 'title: "Chip, quoted"', "status: 'stable'", 'visibility: "private"', 'description: "Says: hi"', "preview: 'full'", "---", ""].join("\n"),
    });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const tree = await buildComponentTree(dir, true, discoveryMap);
    const node = find(tree.roots, "atoms/chip")!;
    expect(node.title).toBe("Chip, quoted");
    expect(node.status).toBe("stable");
    expect(node.visibility).toBe("private");
    const detail = await buildComponentDetail("atoms/chip", dir, noRender, { css: "" }, undefined, new Map(), undefined, undefined, undefined, discoveryMap);
    expect(detail.description).toBe("Says: hi");
    expect(await resolveLayoutMode("atoms/chip", dir, discoveryMap)).toBe("full");
  });

  it("a requireScript list names each script; a single value is one script", async () => {
    const dir = await patterns({
      "atoms/chip/chip.hbs": "<span>c</span>",
      "atoms/chip/chip.md": ["---", "requireScript: [toggle, scripts/menu.ts]", "requireAssets: [icons, flags]", "---", ""].join("\n"),
      "atoms/tag/tag.hbs": "<span>t</span>",
      "atoms/tag/tag.md": ["---", "requireScript: toggle.js", "requireAssets: icons", "---", ""].join("\n"),
    });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    expect(await aggregateRequires("atoms/chip", dir, new Map(), discoveryMap)).toEqual({ scripts: ["toggle", "menu"], assets: ["icons", "flags"] });
    expect(await aggregateRequires("atoms/tag", dir, new Map(), discoveryMap)).toEqual({ scripts: ["toggle"], assets: ["icons"] });
  });
});
