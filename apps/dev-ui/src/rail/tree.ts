// The Nav Rail's component tree — mount, active-item marking, open-state, and search filtering.
//
// Mounted ONCE; navigation only moves aria-current. The markup itself is built by ../rail/tree-util,
// which is pure and unit-tested; this module owns the DOM side.
//
// filterTree iterates `.tree-node`, NOT `.tree-node[data-path]`: buildNodeHtml emits a self-link
// entry with no data-path for a component that also has children, and filtering only on [data-path]
// left it permanently visible while the folder pass resurrected its whole ancestor chain. That was
// a real defect and the selector is the fix — do not narrow it back.

import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { store } from "../core/store.js";
import { routeHref } from "../core/runtime.js";
import type { ComponentTree } from "@pattern-dump/contracts";
import { buildSidebarHtml, hasPackageComponents } from "./tree-util.js";


/** Restore <details open> state for all stored paths that exist in the current tree. */
export function restoreNavOpenState(paths: ReadonlySet<string>): void {
  for (const path of paths) {
    const li = dom.sidebarTree.querySelector<HTMLElement>(`.tree-node[data-path="${CSS.escape(path)}"]`);
    const det = li?.querySelector<HTMLDetailsElement>(":scope > .tree-folder-row > .tree-details");
    if (det) det.open = true;
  }
}

// ---- Tree: mount once, aria-current only ----

export function mountSidebar(): void {
  dom.sidebarTree.innerHTML = buildSidebarHtml(session.tree.roots, 0);
  // Wire persistence to user clicks on <summary>, not toggle events.
  // The toggle event on <details> is a queued task (not synchronous), so a suppression
  // flag around programmatic opens (det.open = true) would reset before the event fires.
  // A click on <summary> only fires for user interaction — det.open = true does not
  // dispatch a click on the summary, so no suppression flag is needed.
  // At click-time, det.open still holds the OLD state; !det.open is the incoming state.
  dom.sidebarTree.querySelectorAll<HTMLElement>("details.tree-details > summary").forEach(summary => {
    summary.addEventListener("click", () => {
      const det = summary.closest<HTMLDetailsElement>("details.tree-details");
      if (!det) return;
      const li = det.closest<HTMLElement>(".tree-node[data-path]");
      if (!li?.dataset.path) return;
      const path = li.dataset.path;
      const paths = new Set(store.local.navOpenPaths);
      const willBeOpen = !det.open;
      if (willBeOpen) paths.add(path);
      else paths.delete(path);
      store.setLocal({ navOpenPaths: paths });
    });
  });
}

export function setActiveTreeItem(path: string): void {
  dom.sidebarTree.querySelectorAll("[aria-current]").forEach(el => el.removeAttribute("aria-current"));
  const link = (
    dom.sidebarTree.querySelector(`a.tree-link[href="${CSS.escape(routeHref(`/${path}`))}"]`) ??
    dom.sidebarTree.querySelector(`a.tree-show-all[href="${CSS.escape(routeHref(`/${path}`))}"]`)
  ) as HTMLAnchorElement | null;
  if (!link) return;
  link.setAttribute("aria-current", "page");

  // Open ancestor and own <details> by walking up the DOM.
  // In the tree structure, <details> is inside .tree-folder-row inside .tree-node.
  let el: Element | null = link.parentElement;
  while (el && el !== dom.sidebarTree) {
    if (el.classList.contains("tree-node")) {
      const det = el.querySelector(":scope > .tree-folder-row > .tree-details") as HTMLDetailsElement | null;
      if (det) det.open = true;
    }
    el = el.parentElement;
  }

  link.scrollIntoView({ block: "nearest" });
}

export function filterTree(query: string): void {
  const q = query.toLowerCase().trim();
  if (!q) {
    dom.sidebarTree.querySelectorAll(".tree-node[data-hidden-search]").forEach(el => {
      (el as HTMLElement).hidden = false;
      (el as HTMLElement).removeAttribute("data-hidden-search");
    });
    return;
  }
  // `.tree-node`, NOT `.tree-node[data-path]`. buildNodeHtml emits a self-link entry for a
  // component that also has children, and that <li> carries no data-path. Filtering only on
  // [data-path] left it permanently visible, and the folder pass below then resurrected its whole
  // ancestor chain (it unhides any folder whose <ul> still holds a non-hidden .tree-node) — so a
  // query matching nothing still showed three nodes. Such an entry has no path to match, so it
  // falls through to the label branch, which is the only identity it has.
  dom.sidebarTree.querySelectorAll(".tree-node").forEach(li => {
    const path = (li as HTMLElement).dataset.path ?? "";
    const linkText = (
      li.querySelector("a.tree-link")?.textContent ??
      li.querySelector(".tree-folder-label")?.textContent ?? ""
    ).toLowerCase();
    const matches = linkText.includes(q) || path.toLowerCase().includes(q);
    (li as HTMLElement).hidden = !matches;
    if (!matches) (li as HTMLElement).dataset.hiddenSearch = "1";
    else (li as HTMLElement).removeAttribute("data-hidden-search");
  });
  const allDetails = Array.from(dom.sidebarTree.querySelectorAll<HTMLDetailsElement>("details.tree-details")).reverse();
  for (const det of allDetails) {
    const li = det.closest(".tree-node") as HTMLElement | null;
    if (!li) continue;
    const ul = li.querySelector(":scope > ul");
    if (!ul) continue;
    const hasVisible = Array.from(ul.querySelectorAll(":scope > .tree-node")).some(
      child => !(child as HTMLElement).hidden
    );
    li.hidden = !hasVisible;
    if (!hasVisible) li.dataset.hiddenSearch = "1";
    else {
      li.removeAttribute("data-hidden-search");
      if (q) det.open = true;
    }
  }
}

/**
 * "Hide packages": components from pattern packages leave the Nav Rail and folder galleries but stay
 * fully usable — composed into project components, listed under Relationships, reachable by URL.
 * The flag is a class on `.main`, which contains both the rail and the gallery; the markup carries
 * `data-package` (see isEffectivelyPackage). The control only appears when the tree has any.
 */
export function applyPackageFilter(hide: boolean): void {
  dom.hidePackagesCheck.checked = hide;
  dom.mainEl.classList.toggle("hide-packages", hide);
}

export function syncPackageControl(tree: ComponentTree): void {
  dom.hidePackagesLabel.hidden = !hasPackageComponents(tree.roots);
}
