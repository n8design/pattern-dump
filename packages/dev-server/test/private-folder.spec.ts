// `visibility: private` on a folder's index.md hides the folder like a private component: its components stay out
// of every ancestor's gallery, and a folder whose only public components are inside a private folder has no
// gallery. The gallery walk used to list every public component beneath a folder, whatever was private above
// it. The private folder's own gallery (open with internals shown) still lists its components. Fixtures are
// throwaway, as in layout-mode.spec.ts.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TreeNode } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { buildComponentTree } from "../src/component-tree.js";
import { buildFolderOverview } from "../src/overview.js";
import { save } from "../../../test-support/save.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function patterns(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pd-private-folder-"));
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

const FILES = {
  "molecules/card/card.hbs": "<div>card</div>",
  "molecules/internals/index.md": "---\nvisibility: private\n---\n",
  "molecules/internals/shim/shim.hbs": "<span>shim</span>",
  "molecules/internals/deep/spacer/spacer.hbs": "<span>spacer</span>",
  "helpers/index.md": "---\nvisibility: private\n---\n",
  "helpers/kit/kit.hbs": "<span>kit</span>",
};
const noRender = async () => ({ html: "" });

describe("a private folder", () => {
  it("keeps its components out of an ancestor's gallery", async () => {
    const dir = await patterns(FILES);
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const overview = await buildFolderOverview("molecules", dir, noRender, discoveryMap);
    expect(overview.components.map(i => i.id)).toEqual(["molecules/card"]);
  });

  it("lists its own components in its own gallery", async () => {
    const dir = await patterns(FILES);
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const overview = await buildFolderOverview("molecules/internals", dir, noRender, discoveryMap);
    expect(overview.components.map(i => i.id).sort()).toEqual(["molecules/internals/deep/spacer", "molecules/internals/shim"]);
  });

  it("gives no gallery to a folder whose public components are all inside private folders", async () => {
    const dir = await patterns({ ...FILES, "outer/index.md": "---\ntitle: Outer\n---\n", "outer/hidden/index.md": "---\nvisibility: private\n---\n", "outer/hidden/x/x.hbs": "<i>x</i>" });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const tree = await buildComponentTree(dir, true, discoveryMap);
    expect(find(tree.roots, "outer")!.hasOverview).toBe(false);
    expect(find(tree.roots, "molecules")!.hasOverview).toBe(true);
    expect(find(tree.roots, "molecules/internals")!.visibility).toBe("private");
  });
});
