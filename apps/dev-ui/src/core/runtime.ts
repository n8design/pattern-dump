// How this shell was served — live by `pd dev`, or from a `pd build` snapshot on a static host — and
// the URL mapping that follows from it.
//
// The server inlines `window.__pd` (ShellRuntime). Live, nothing changes: URLs are the routes as the
// dev server knows them. Static, two things move:
//   - requests: every root-relative request goes to the snapshot file `staticPathFor` names, under
//     the base path (the contract shared with `pd build`, so the reader cannot drift from the writer);
//   - routes: the shell may be hosted under a subpath, so rendered hrefs gain the base path and the
//     current location loses it before routing. Route paths inside the shell stay "/atoms/button".

import { normalizeBasePath, staticPathFor, type ShellRuntime } from "@pattern-dump/contracts";

declare global { interface Window { __pd?: ShellRuntime } }

export const runtime: ShellRuntime =
  (typeof window !== "undefined" && window.__pd) || { mode: "live", wsPort: 4001 };

export const isStatic = runtime.mode === "static";

/** Whether this shell offers the corpus audit: always live; in a static build unless it was left out. */
export const auditAvailable = runtime.mode === "live" || runtime.audit !== false;

/** "/" live; the snapshot's slash-wrapped base path static. */
export const basePath = runtime.mode === "static" ? normalizeBasePath(runtime.basePath) : "/";

/** The URL to request for a live route URL ("/api/tree", "/preview/…", "/_pd/…"). */
export function resourceUrl(liveUrl: string): string {
  return isStatic && liveUrl.startsWith("/") ? `${basePath}${staticPathFor(liveUrl)}` : liveUrl;
}

/** An in-app route ("/atoms/button") as an href / history URL. */
export function routeHref(route: string): string {
  return basePath === "/" ? route : `${basePath}${route.replace(/^\/+/, "")}`;
}

/** The in-app route for a location pathname: the base path removed, always starting with "/". */
export function routeFromPathname(pathname: string): string {
  if (basePath === "/" || !pathname.startsWith(basePath)) return pathname;
  return `/${pathname.slice(basePath.length)}`;
}

/**
 * In static mode, send every root-relative fetch through resourceUrl. The shell's fetch sites all
 * pass live route URLs built by the contract builders; mapping them here, once, keeps those sites
 * identical in both modes. Absolute URLs (other origins) pass through untouched.
 */
export function installStaticFetch(): void {
  if (!isStatic || typeof window === "undefined") return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    original(typeof input === "string" ? resourceUrl(input) : input, init);
}
