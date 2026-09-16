// Folder overview — the gallery shown when a group node is selected in the Nav Rail.
//
// Lists the PUBLIC components under a folder, taken from the folder's subtree in the component tree —
// so the overview and the Nav Rail cannot disagree about what is public, or about order.
//
// Explicit arguments; no server state.


import { join } from "node:path";
import { readFolderFile, type PatternDirs } from "./pattern-dirs.js";
import type {
  DiscoveryMap, FolderOverview, FolderOverviewItem, LayoutMode, TreeNode,
} from "@pattern-dump/contracts";
import { FULL_CATEGORIES } from "./layout-mode.js";
import { buildSubtree } from "./component-tree.js";
import { renderDoc } from "./markdown.js";

export async function buildFolderOverview(
  folderPath: string,
  patternsDir: PatternDirs,
  renderFn: (input: { component: string; variant?: string }) => Promise<{ html: string }>,
  discoveryMap: DiscoveryMap
): Promise<FolderOverview> {
  const category  = folderPath.split("/")[0];

  let folderLayout: LayoutMode = FULL_CATEGORIES.has(category) ? "full" : "centered";
  let doc: string | undefined;

  try {
    const rawIndex = await readFolderFile(patternsDir, join(folderPath, "index.md"));
    if (rawIndex === null) throw new Error("no index.md");
    const m = rawIndex.match(/^preview:\s*(centered|full)$/m);
    if (m) folderLayout = m[1] as LayoutMode;
    const stripped = rawIndex.replace(/^---[\s\S]*?---\n?/, "").trim();
    if (stripped) {
      doc = await renderDoc(
        stripped,
        (id, variant) => renderFn({ component: id, variant }).then(r => r.html),
        discoveryMap
      );
    }
  } catch { /* no index.md */ }

  const components = await collectPublicLeaves(folderPath, patternsDir, discoveryMap);

  return { path: folderPath, doc, layout: folderLayout, components };
}

/** The public components at or under the folder, in TREE order — pre-order, so a component precedes
 *  its own sub-components, and siblings follow tree-order.ts. Derived from the tree rather than
 *  re-read, so the gallery lists exactly what the Nav Rail shows, in the same order. */
async function collectPublicLeaves(
  folderPath: string,
  patternsDir: PatternDirs,
  discoveryMap: DiscoveryMap
): Promise<FolderOverviewItem[]> {
  const root = await buildSubtree(folderPath, patternsDir, discoveryMap);
  const items: FolderOverviewItem[] = [];
  const walk = (node: TreeNode): void => {
    if (node.kind === "component" && node.visibility !== "private") {
      items.push({
        id: node.path, title: node.title, status: node.status ?? "draft", layout: node.layout ?? "centered",
        ...(node.source ? { source: node.source } : {}),
      });
    }
    node.children?.forEach(walk);
  };
  if (root) walk(root);
  return items;
}
