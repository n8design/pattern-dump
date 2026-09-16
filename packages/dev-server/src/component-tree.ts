// The component tree served to the Nav Rail.
//
// Map-driven: re-sourced from the DiscoveryMap on every rebuild rather than re-walking the
// filesystem, so the tree and every derived graph agree on identity by construction. Folders are
// grouping only — they never affect a component's id (M6 file-as-component).
//
// Variants (`~`) are excluded from the tree: a variant is reachable from its base, not a separate
// node. Sibling order is tree-order.ts's rule. No server state.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ComponentStatus, ComponentTree, DiscoveryMap, LayoutMode, TreeNode,
} from "@pattern-dump/contracts";
import { resolveLayoutMode } from "./layout-mode.js";
import { readFolderFile, type PatternDirs } from "./pattern-dirs.js";
import { readFrontmatter } from "./frontmatter.js";
import { orderSiblings, parseOrder, type Orderable, type OrderSpec } from "./tree-order.js";

/** Return all direct child path strings for a given parent path from a flat id list. */
function directChildPaths(parentPath: string, allIds: string[]): string[] {
  const prefix = `${parentPath}/`;
  const seen = new Set<string>();
  for (const id of allIds) {
    if (id === parentPath || !id.startsWith(prefix)) continue;
    const segment = id.slice(prefix.length).split("/")[0];
    seen.add(`${parentPath}/${segment}`);
  }
  return [...seen];
}

/** Display title for a folder with no `title:` of its own: "organisms" → "Organisms",
 *  "quick-links" → "Quick links". Components keep their raw name — it is their handle's tail and
 *  what authors search for; a folder is only a label. */
export function folderTitle(segment: string): string {
  const words = segment.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return segment;
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const readText = (path: string): Promise<string | null> => readFile(path, "utf-8").catch(() => null);

/** The `order:` value from a file's frontmatter, if any. */
function orderOf(md: string | null): OrderSpec | undefined {
  return md === null ? undefined : parseOrder(readFrontmatter(md)["order"]);
}

/** True when this node or anything beneath it is a component not marked private. The same set a
 *  folder overview lists — overview.ts derives its items from this tree, so the two cannot disagree. */
export function hasPublicComponent(node: TreeNode): boolean {
  if (node.kind === "component" && node.visibility !== "private") return true;
  return node.children?.some(hasPublicComponent) ?? false;
}

export async function buildComponentTree(
  patternsDir: PatternDirs,
  overviewsEnabled: boolean,
  discoveryMap: DiscoveryMap
): Promise<ComponentTree> {
  const baseIds = [...discoveryMap.keys()].filter(id => !id.includes("~"));
  const categories = [...new Set(baseIds.map(id => id.split("/")[0]))];
  const built: BuiltNode[] = [];
  for (const cat of categories) {
    const catIds = baseIds.filter(id => id === cat || id.startsWith(`${cat}/`));
    const node = await buildTreeNodeFromMap(cat, catIds, patternsDir, overviewsEnabled, discoveryMap);
    if (node) built.push(node);
  }
  const rootOrder = orderOf(await readFolderFile(patternsDir, "index.md"));
  const list = rootOrder && "list" in rootOrder ? rootOrder.list : undefined;
  return { roots: orderSiblings(built, list).map(b => b.node) };
}

/** One folder's subtree, ordered — or null when nothing is discovered at or under it. */
export async function buildSubtree(
  folderPath: string,
  patternsDir: PatternDirs,
  discoveryMap: DiscoveryMap
): Promise<TreeNode | null> {
  const ids = [...discoveryMap.keys()]
    .filter(id => !id.includes("~") && (id === folderPath || id.startsWith(`${folderPath}/`)));
  if (ids.length === 0) return null;
  return (await buildTreeNodeFromMap(folderPath, ids, patternsDir, true, discoveryMap))?.node ?? null;
}

interface BuiltNode extends Orderable {
  node: TreeNode;
}

async function buildTreeNodeFromMap(
  nodePath: string,
  idsUnderPath: string[],
  patternsDir: PatternDirs,
  overviewsEnabled: boolean,
  discoveryMap: DiscoveryMap
): Promise<BuiltNode | null> {
  const name = nodePath.split("/").pop()!;
  if (name.startsWith(".")) return null;

  const entry = discoveryMap.get(nodePath);
  const isComponent = entry !== undefined;

  let title = name;
  let status: ComponentStatus = "draft";
  let visibility: "public" | "private" | undefined;
  let weight: number | undefined;

  if (isComponent && entry.mdPath) {
    const md = await readText(entry.mdPath);
    if (md !== null) {
      const t = md.match(/^title:\s*(.+)$/m);
      const s = md.match(/^status:\s*(.+)$/m);
      const v = md.match(/^visibility:\s*(public|private)$/m);
      if (t) title = t[1].trim();
      if (s) {
        const sv = s[1].trim();
        if (sv === "stable" || sv === "deprecated" || sv === "draft") status = sv as ComponentStatus;
      }
      if (v) visibility = v[1] as "public" | "private";
      const o = orderOf(md);
      if (o && "weight" in o) weight = o.weight;
    }
  }

  // The folder's index.md (optional) orders this node's children and, for a group, titles it.
  const indexMd = await readFolderFile(patternsDir, join(nodePath, "index.md"));
  const folderOrder = orderOf(indexMd);

  const built: BuiltNode[] = [];
  for (const childPath of directChildPaths(nodePath, idsUnderPath)) {
    const childIds = idsUnderPath.filter(id => id === childPath || id.startsWith(`${childPath}/`));
    const child = await buildTreeNodeFromMap(childPath, childIds, patternsDir, overviewsEnabled, discoveryMap);
    if (child) built.push(child);
  }
  const children = orderSiblings(built, folderOrder && "list" in folderOrder ? folderOrder.list : undefined)
    .map(b => b.node);

  const kind: "group" | "component" = isComponent ? "component" : "group";
  let layout: LayoutMode | undefined;
  if (isComponent) layout = await resolveLayoutMode(nodePath, patternsDir, discoveryMap);

  let hasOverview = false;
  if (!isComponent) {
    let titled = false;
    if (indexMd !== null) {
      const t = indexMd.match(/^title:\s*(.+)$/m);
      if (t) { title = t[1].trim(); titled = true; }
      if (!visibility) {
        const v = indexMd.match(/^visibility:\s*(public|private)$/m);
        if (v) visibility = v[1] as "public" | "private";
      }
      if (folderOrder && "weight" in folderOrder) weight = folderOrder.weight;
    }
    if (!titled) title = folderTitle(name);
    // index.md is optional: any group with a public component beneath it gets an overview.
    // `overview: false` in index.md opts one folder out; the global switch opts all out.
    const optedOut = indexMd !== null && /^overview:\s*false$/m.test(indexMd);
    hasOverview = overviewsEnabled && !optedOut && children.some(hasPublicComponent);
  }

  const node: TreeNode = {
    path: nodePath,
    title,
    kind,
    hasOverview,
    ...(isComponent ? { status, layout } : {}),
    ...(isComponent && entry.source ? { source: entry.source } : {}),
    ...(visibility ? { visibility } : {}),
    ...(children.length ? { children } : {}),
  };
  return { node, segment: name, ...(weight !== undefined ? { weight } : {}) };
}
