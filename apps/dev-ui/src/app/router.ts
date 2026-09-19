// The SPA router — the sole entry from a URL to a rendered view.
//
// Every navigation path funnels through routeFromCurrentLocation: a link click (after pushState),
// Back/Forward (popstate), a hash change, and the initial load. A click only pushes the URL; THIS is
// the one place that decides what the URL means and dispatches to app/navigation to render it.
// Keeping it single is what makes deep links, Back/Forward and open-in-new-tab behave identically.
//
// Depends on ./navigation.js and not the reverse — navigation renders what it is told and never
// consults the URL itself.

import { routeFromPathname, routeHref } from "../core/runtime.js";
import type { TreeNode } from "@pattern-dump/contracts";
import { session } from "../core/session.js";
import { store, parseUrlState } from "../core/store.js";
import { applyCvd } from "../rail/a11y-control.js";
import { applyViewport } from "../stage/viewport.js";
import { navigate, navigateOverview, navigateUnknown, navigateVariants, swapVariant } from "./navigation.js";


function resolvePathKind(path: string): "component" | "group" | null {
  function findNode(nodes: TreeNode[]): TreeNode | null {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (n.children) {
        const found = findNode(n.children);
        if (found) return found;
      }
    }
    return null;
  }
  const node = findNode(session.tree.roots);
  return node ? node.kind : null;
}

// Read the current URL and route to the matching view. All navigation paths —
// link clicks (after pushState), popstate (Back/Forward), and initial load —
// call this function. A click only pushes the URL; this is the sole place that
// fetches data and renders regions.
export async function routeFromCurrentLocation(): Promise<void> {
  // Sync store.url.viewport + cvd from the actual URL (handles popstate after back/forward).
  const parsedUrl = parseUrlState(window.location);
  if (parsedUrl.viewport !== store.url.viewport) {
    store.setUrl({ viewport: parsedUrl.viewport });
    applyViewport();
  }
  const parsedCvd = parsedUrl.cvd;
  if (parsedCvd.type !== store.url.cvd.type || parsedCvd.severity !== store.url.cvd.severity) {
    store.setUrl({ cvd: parsedCvd });
    applyCvd();
  }

  const path = routeFromPathname(window.location.pathname).slice(1);
  // A PatternLab-style link names the route in the hash (/#/pages/home). Move it into the path, which
  // is where routes live here; a variant hash (#ghost) never starts with a slash.
  if (!path && window.location.hash.startsWith("#/")) {
    history.replaceState(history.state, "", routeHref(window.location.hash.slice(1)) + window.location.search);
    return routeFromCurrentLocation();
  }
  // Variant is now in the URL hash (#ghost), not ?v= query param.
  const variant = window.location.hash.slice(1) || undefined;
  if (!path) return;

  if (path.endsWith("/variants")) {
    const componentId = path.slice(0, -"/variants".length);
    if (resolvePathKind(componentId) === "component") {
      await navigateVariants(componentId);
      return;
    }
  }

  const kind = resolvePathKind(path);
  if (kind === "component") {
    // Same component, different variant → use the cheap swap path (no full detail re-fetch).
    // Force full navigate when in gallery mode so it exits the gallery (stageMode reset).
    if (session.current && session.current.id === path && session.stageMode !== "variants") {
      await swapVariant(path, variant ?? null);
    } else {
      await navigate(path, variant);
    }
  } else if (kind === "group") {
    await navigateOverview(path);
  } else {
    await navigateUnknown(path, variant);
  }
}
