// Links into the workbench from inside it: a link to a workbench pattern in the Stage's preview, or in a component's
// docs, selects that pattern with the workbench's own navigation, scrolled to the top, instead of loading a second
// workbench inside the frame. A link that leaves the workbench opens in the top window.
//
// The preview document is never changed for this (non-negotiable 8): the shell attaches its own listener to the
// frame's document after each load (the frame is same-origin by contract), and if the frame navigates anyway (a
// script, a form, a click the listener didn't see), the shell reads the frame's new address when it loads, selects the
// pattern it names, and puts the preview back.

import { dom } from "../core/dom.js";
import { routeFromPathname, routeHref } from "../core/runtime.js";
import { session } from "../core/session.js";
import { currentVpParam } from "../stage/viewport.js";
import { navigate } from "./navigation.js";
import { resolvePathKind, routeFromCurrentLocation } from "./router.js";

/** The names pd dev answers to as the workbench: a link may name any of them at the workbench's port. */
const WORKBENCH_HOSTS = new Set(["localhost", "127.0.0.1", "pd.localhost"]);

/** The workbench route an address names, with its hash: one the tree knows (a pattern or a folder), on the
 *  workbench's own origin (or pd dev's other workbench names at its port), under its base path, or under
 *  `/workbench/` (the address docs written for a published site use). Null for anything else. */
export function workbenchRoute(href: string): { route: string; hash: string } | null {
  let url: URL;
  try { url = new URL(href, location.href); } catch { return null; }
  const sameServer = url.origin === location.origin
    || (url.port === location.port && WORKBENCH_HOSTS.has(url.hostname) && WORKBENCH_HOSTS.has(location.hostname));
  if (!sameServer) return null;
  const candidates = [routeFromPathname(url.pathname)];
  if (url.pathname.startsWith("/workbench/")) candidates.push(url.pathname.slice("/workbench".length));
  for (const candidate of candidates) {
    const route = candidate.replace(/\/+$/, "") || "/";
    if (route !== "/" && resolvePathKind(route.slice(1))) return { route, hash: url.hash };
  }
  return null;
}

/** Show a workbench route with the workbench's own navigation, and the Stage from its top. */
export async function followWorkbenchRoute(target: { route: string; hash: string }): Promise<void> {
  history.pushState({}, "", routeHref(target.route) + currentVpParam() + target.hash);
  await routeFromCurrentLocation();
  dom.stageView.scrollTo({ top: 0 });
  dom.singlePreview.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
}

/** A plain click on a link: unmodified, the main button, no target of its own, not to a place in its own document,
 *  http(s). Anything else stays the browser's. */
function plainLink(e: MouseEvent): HTMLAnchorElement | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return null;
  if (a.target && a.target !== "_self") return null;
  if ((a.getAttribute("href") ?? "").startsWith("#")) return null;
  if (a.protocol !== "http:" && a.protocol !== "https:") return null;
  return a;
}

/** The Stage frame's document as it loaded: its links, caught by the shell's own listener. */
function watchFrameDocument(doc: Document): void {
  doc.addEventListener("click", e => {
    const a = plainLink(e);
    if (!a) return;
    e.preventDefault();
    const target = workbenchRoute(a.href);
    if (target) void followWorkbenchRoute(target);
    else window.location.assign(a.href); // it leaves the workbench: the top window, never the frame
  });
}

/** Wire the Stage frame: its links after each load, and what to do when it navigated away from its document. */
export function wireFrameLinks(): void {
  dom.iframe.addEventListener("load", () => {
    let address: string | null = null;
    let doc: Document | null = null;
    try {
      address = dom.iframe.contentWindow?.location.href ?? null;
      doc = dom.iframe.contentDocument;
    } catch { address = null; } // another origin: nothing of it can be read
    // Its own document: watch its links.
    if (address === "about:srcdoc") {
      if (doc) watchFrameDocument(doc);
      return;
    }
    if (address === "about:blank") return;
    // The frame left its document. A pattern's address: show it as the workbench does. Anything else: put the preview
    // back, and open what the frame went to in the top window when it can be read.
    const target = address ? workbenchRoute(address) : null;
    if (target) { void followWorkbenchRoute(target); return; }
    if (session.current) void navigate(session.current.id, session.currentVariant ?? undefined);
    if (address) window.location.assign(address);
  });
}

/** A plain link in a component's docs (the Inspector) to a workbench pattern: the same navigation. Returns whether it
 *  handled the click. */
export function followDocsLink(e: MouseEvent): boolean {
  const a = plainLink(e);
  if (!a) return false;
  const target = workbenchRoute(a.href);
  if (!target) return false;
  e.preventDefault();
  void followWorkbenchRoute(target);
  return true;
}
