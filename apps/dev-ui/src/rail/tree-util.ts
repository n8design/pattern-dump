// Pure functions over the component tree — shape in, string or set out.
//
// No module state, no DOM refs, no store access. Verified rather than assumed: the one apparent
// reference to the module-level `tree` binding turned out to be the text `.tree-folder-row` inside a
// COMMENT, which a literal-stripping audit does not remove. The functions are genuinely pure.
//
// `buildNodeHtml` is the only place in the shell that interpolates untrusted project content
// (component titles and paths) into markup, so every interpolation is escaped. That safety is
// currently manual — a forgotten escapeAttr() here would be a real injection. It is the primary
// motivation for the `html` tag that replaces these string builders later, which makes escaping the
// default rather than something a human must remember at each site.

import type { TreeNode } from "@pattern-dump/contracts";
import { svgIcon } from "../icons/index.js";
import { escapeAttr } from "../core/html-util.js";
import { routeHref } from "../core/runtime.js";

/** Collect paths of all nodes that have children (they render <details> elements). */
export function extractFolderPaths(nodes: TreeNode[]): Set<string> {
  const paths = new Set<string>();
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      paths.add(n.path);
      for (const p of extractFolderPaths(n.children)) paths.add(p);
    }
  }
  return paths;
}

export function buildSidebarHtml(nodes: TreeNode[], depth: number): string {
  return nodes.map(n => buildNodeHtml(n, depth)).join("");
}

/** The folders that are the site's machinery, not the project's own taxonomy: what a site's pages are built from. */
export const SITE_FOLDERS: readonly string[] = ["layouts", "partials", "views"];

/** The Site folder's key in the rail's remembered open folders: no component or folder has a path with a colon. */
export const SITE_PATH = "pd:site";

/** The site's line under its heading. */
export const SITE_DESCRIPTION = "Layouts, partials and views: what the site's pages are built from.";

/** The top-level nodes split into the project's own folders and the site's (SITE_FOLDERS), each in tree order. */
export function splitSiteRoots(nodes: TreeNode[]): { own: TreeNode[]; site: TreeNode[] } {
  return {
    own: nodes.filter(n => !SITE_FOLDERS.includes(n.path)),
    site: nodes.filter(n => SITE_FOLDERS.includes(n.path)),
  };
}

/**
 * The Nav Rail's tree: the project's own folders first, in whatever taxonomy, then, for a project with a site, its
 * machinery under one more folder, "Site", with a line that says what it holds. The Site folder is built as any
 * folder is (a <details> row and a list), so it opens, closes, opens on a selection inside it and filters as they do;
 * it starts closed. Without a site, or with none of its folders, the tree is as it was.
 */
export function buildRailHtml(nodes: TreeNode[], hasSite: boolean): string {
  const { own, site } = splitSiteRoots(nodes);
  if (!hasSite || site.length === 0) return buildSidebarHtml(nodes, 0);
  return `${buildSidebarHtml(own, 0)}<li class="tree-node tree-site" data-path="${SITE_PATH}">
<div class="tree-folder-row" data-depth="0"><details class="tree-details" data-depth="0"><summary class="tree-folder"><span class="disclosure-caret" aria-hidden="true">${svgIcon("chevron")}</span><span class="tree-folder-label">Site</span></summary></details></div>
<p class="tree-site-description">${SITE_DESCRIPTION}</p>
<ul role="list">${buildSidebarHtml(site, 1)}</ul>
</li>`;
}


// A node should be hidden with "Show private" off if:
// - it is explicitly private, OR
// - it is a GROUP whose every descendant is effectively private (empty parent hiding).
// A component is never private by inheritance: a public owner of private sub-components stays visible.
export function isEffectivelyPrivate(node: TreeNode): boolean {
  if (node.visibility === "private") return true;
  if (node.kind === "component") return false;
  if (!node.children || node.children.length === 0) return false;
  return node.children.every(isEffectivelyPrivate);
}

/** A node counts as a package's when it is a component from a pattern package, or a group whose
 *  every descendant is — the same empty-parent rule as privacy, so a category shared by the project
 *  and a package stays visible when packages are hidden. */
export function isEffectivelyPackage(node: TreeNode): boolean {
  if (node.kind === "component") return node.source !== undefined;
  if (!node.children || node.children.length === 0) return false;
  return node.children.every(isEffectivelyPackage);
}

/** Whether any component in the tree comes from a pattern package (the control is shown only then). */
export function hasPackageComponents(nodes: TreeNode[]): boolean {
  return nodes.some(n => (n.kind === "component" && n.source !== undefined) || hasPackageComponents(n.children ?? []));
}

export function buildNodeHtml(node: TreeNode, depth: number): string {
  const isPrivate = isEffectivelyPrivate(node);
  const privateAttr = (isPrivate ? " data-private" : "") + (isEffectivelyPackage(node) ? " data-package" : "");
  const hasChildren = node.children && node.children.length > 0;

  if (hasChildren) {
    const titleEscaped = escapeAttr(node.title);
    const pathEscaped = escapeAttr(node.path);
    const showAllLink = node.hasOverview
      ? `<a href="${routeHref(`/${pathEscaped}`)}" class="tree-show-all" aria-label="Show all ${titleEscaped}">All</a>`
      : "";
    // Component nodes that also have children (e.g. field molecule) get a link to themselves.
    let firstItem = "";
    if (!node.hasOverview && node.kind === "component") {
      firstItem = `<li class="tree-node"><a href="${routeHref(`/${pathEscaped}`)}" class="tree-link">${titleEscaped}</a></li>`;
    }
    const childrenHtml = buildSidebarHtml(node.children!, depth + 1);
    // The <details> (native toggle) and show-all link share the sticky .tree-folder-row.
    // The <ul> is a sibling of .tree-folder-row; CSS :has() shows it when <details> is open.
    // This keeps the show-all link outside <summary>, avoiding nested-interactive axe violations.
    return `<li class="tree-node"${privateAttr} data-path="${pathEscaped}">
<div class="tree-folder-row" data-depth="${depth}"><details class="tree-details" data-depth="${depth}"><summary class="tree-folder"><span class="disclosure-caret" aria-hidden="true">${svgIcon("chevron")}</span><span class="tree-folder-label">${titleEscaped}</span></summary></details>${showAllLink}</div>
<ul role="list">${firstItem}${childrenHtml}</ul>
</li>`;
  }

  const privateBadge = isPrivate ? ` <span class="private-badge">private</span>` : "";
  return `<li class="tree-node"${privateAttr} data-path="${escapeAttr(node.path)}"><a href="${routeHref(`/${escapeAttr(node.path)}`)}" class="tree-link">${escapeAttr(node.title)}${privateBadge}</a></li>`;
}
