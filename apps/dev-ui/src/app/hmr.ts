// The HMR client — the dev server's push channel into the shell.
//
// The riskiest module in the shell, and deliberately the last behaviour module moved. It reacts to
// every HmrMessage type — checked exhaustively at compile time — by writing session.current,
// invalidating the per-selection caches, re-fetching component detail, and calling back into all
// four regions. Every one of those callees had to be
// importable by name before this could move, which is why it follows the regions and navigation.
//
// The socket frame is typed as the DECLARED HmrMessage union. The server already enforces that
// union when sending; this side used to parse into an index signature and re-cast every field by
// hand, so the two ends could drift with nothing failing until runtime.
//
// Two policies worth knowing before editing:
//   - The audit-freshness refresh sits OUTSIDE the `componentId === current?.id` gates: any template
//     or render change invalidates the corpus rollup, whichever component is selected.
//   - EVERY error is surfaced on the Console, not only component-scoped ones. A SCSS build failure
//     carries no componentId, and gating on it is how build errors used to vanish entirely.

import type { ComponentTree, HmrMessage, TreeNode } from "@pattern-dump/contracts";
import { PD_ROUTES, previewUrl } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { fetchDetail, heard, loadDocument } from "../core/generation.js";
import { extractHighlightedPre } from "../core/html-util.js";
import { reconcilePdLinks } from "../core/pd-links.js";
import { protocolMismatch } from "../core/protocol.js";
import { session } from "../core/session.js";
import { routeFromPathname, runtime } from "../core/runtime.js";
import { store } from "../core/store.js";
import { runRenderedA11yScan } from "../dock/a11y-scan.js";
import { refreshDiagnostics } from "../dock/diagnostics.js";
import { fetchAndShowData, fetchAndShowHtml, renderConsole } from "../dock/tabs.js";
import { refreshAudit } from "../inspector/audit.js";
import { renderPanel } from "../inspector/panel.js";
import { extractFolderPaths } from "../rail/tree-util.js";
import { filterTree, mountSidebar, restoreNavOpenState, setActiveTreeItem, syncPackageControl } from "../rail/tree.js";
import { navigateOverview } from "./navigation.js";
import { resetContentHeight } from "../stage/content-height.js";
import { remeasureAll } from "../stage/content-width.js";

export function connectHmr(): void {
  // A static build has no server to reload from (see core/runtime.ts).
  if (runtime.mode !== "live") return;
  const ws = new WebSocket(`ws://localhost:${runtime.wsPort}`);

  ws.addEventListener("open", () => {
    dom.railStatus.dataset.state = "connected";
    dom.railStatusLabel.textContent = "Connected";
    renderConsole("HMR connected");
  });

  ws.addEventListener("close", () => {
    dom.railStatus.dataset.state = "disconnected";
    dom.railStatusLabel.textContent = "disconnected"; // announces once via role="status"
    renderConsole("HMR disconnected — retrying…");
    setTimeout(() => connectHmr(), 1000);
  });

  ws.addEventListener("message", async (e) => {
    // Typed as the DECLARED union, not `{ type: string; [k: string]: unknown }`. The server already
    // enforces it on the sending side (hotreloader.push takes HmrMessage); until now the receiving
    // side threw it away and re-cast every field by hand, so the two ends could drift with nothing
    // failing until runtime. The cast at the JSON.parse boundary is unavoidable — that is where
    // untyped bytes become values — but it is now ONE assertion instead of seven.
    let msg: HmrMessage;
    try {
      msg = JSON.parse(e.data as string) as HmrMessage;
    } catch { return; }
    // Every reload message, and hello, says how far the server's changes have got (core/generation.ts).
    if ("generation" in msg) heard(msg.generation);

    // Corpus audit freshness — ANY component's template/render change invalidates the corpus rollup,
    // so refetch when the facet is open, regardless of which component is selected (deliberately
    // OUTSIDE the `componentId === current?.id` gates below). CSS edits do NOT re-audit the graph
    // (server-side CSS-invariance), but a theme or base-layer .scss edit reloads the preview with a
    // content-swap, so it refetches too: harmless, the rollup comes back unchanged. No polling.
    if ((msg.type === "content-swap" || msg.type === "error") && store.local.panelTab === "audit") {
      refreshAudit();
    }

    if (msg.type === "content-swap") {
      const componentId = msg.componentId;
      if (componentId === session.current?.id) {
        session.renderedHtmlCache = null;
        session.rawRenderedHtml = null;
        session.dataCache = null;
        session.dataRaw = null;
        dom.htmlBody.innerHTML = "";
        dom.dataBody.innerHTML = "";
        if (session.stageMode === "variants") {
          // Re-render each gallery tile in-place (mirrors the CSS iterate-all-frames pattern).
          // Each tile carries data-pd-variant so we can fetch the correct per-variant doc.
          const tiles = Array.from(
            dom.variantsGalleryEl.querySelectorAll<HTMLIFrameElement>(".gallery-item iframe")
          );
          // Each tile: never an older document than it shows, fetched again if it predates a change heard.
          await Promise.all(tiles.map(f => {
            const vp = f.dataset.pdVariant || undefined;
            return loadDocument(`tile:${vp ?? ""}`, `${componentId}~${vp ?? ""}`, previewUrl(componentId, vp, store.local.theme || undefined), doc => {
              f.srcdoc = doc;
              console.log("%c[pd] srcdoc reloaded", "color:#7ed321;font-weight:bold",
                `— ${componentId} (${vp ?? "default"})`);
            }, () => f.isConnected && session.current?.id === componentId);
          }));
        } else {
          const variant = session.currentVariant;
          await loadDocument("preview", `${componentId}~${variant ?? ""}`, previewUrl(componentId, variant ?? undefined, store.local.theme || undefined), doc => {
            dom.iframe.srcdoc = doc;
            console.log("%c[pd] srcdoc reloaded", "color:#7ed321;font-weight:bold", `— ${componentId}`);
          }, () => session.current?.id === componentId && session.currentVariant === variant);
        }
        // Re-render the active view.
        { const d = store.local.dock;
          if (d.dockTab === "source" && d.sourceFacet === "hbs") {
            dom.hbsBody.innerHTML = extractHighlightedPre(session.current.source.hbsHighlighted);
          } else if (d.dockTab === "html") {
            void fetchAndShowHtml();
          } else if (d.dockTab === "source" && d.sourceFacet === "data") {
            void fetchAndShowData();
          }
        }
        // Re-fetch component detail so relationships + source + diagnostics stay fresh.
        void fetchDetail(componentId, session.currentVariant ?? undefined)
          .then(d => {
            if (!d) return;
            session.current = d;
            session.renderedA11y = [];
            session.scanPending = store.local.dock.dockTab === "diagnostics";
            refreshDiagnostics();
            if (store.local.dock.dockTab === "diagnostics") {
              // srcdoc was just replaced — scan after the new document loads.
              dom.iframe.addEventListener("load", () => void runRenderedA11yScan(), { once: true });
            }
            { const d = store.local.dock;
              if (d.dockTab === "source" && d.sourceFacet === "hbs") {
                dom.hbsBody.innerHTML = extractHighlightedPre(session.current.source.hbsHighlighted);
              }
            }
            // Docs come from the component's .md, which a content-swap may be about.
            if (store.local.panelTab === "relationships" || store.local.panelTab === "docs") void renderPanel();
          })
          .catch(() => { /* ignore — stale current is better than a crash */ });
      }
    } else if (msg.type === "hello") {
      const mismatch = protocolMismatch(msg.protocol);
      if (mismatch) {
        dom.railStatus.dataset.state = "disconnected";
        dom.railStatusLabel.textContent = "Protocol mismatch";
        renderConsole(mismatch, "error");
      }
    } else if (msg.type === "css-link-swap") {
      const componentId = msg.componentId;
      const href = msg.href;
      const orderedHrefs = msg.orderedHrefs;

      if (orderedHrefs !== undefined) {
        // Full reconcile (add / remove / bump) for frames that show lastComponentId:
        // the single preview and the variants-gallery tiles. Empty array IS valid reconcile
        // data — it means "the closure has zero linkable components, remove all pd-links"
        // (e.g. removing the last styleUses edge from a zero-CSS component's closure).
        const previewFrame = document.getElementById("preview-frame") as HTMLIFrameElement | null;
        if (previewFrame) reconcilePdLinks(previewFrame.contentDocument, orderedHrefs);
        document.querySelectorAll<HTMLIFrameElement>("#variants-gallery .gallery-item iframe")
          .forEach(f => reconcilePdLinks(f.contentDocument, orderedHrefs));

        // Keyed bump only for overview tiles (each shows a different component — a full
        // reconcile against lastComponentId's closure would strip that tile's own links).
        document.querySelectorAll<HTMLIFrameElement>("iframe").forEach(f => {
          if (f.id === "preview-frame") return;
          if (f.closest("#variants-gallery")) return;
          const link = f.contentDocument?.querySelector<HTMLLinkElement>(`link[data-pd-comp="${componentId}"]`);
          if (link) link.href = href;
        });
      } else {
        // Fallback: server sent no orderedHrefs (pre-reconcile broadcast) — keyed bump only.
        document.querySelectorAll<HTMLIFrameElement>("iframe").forEach(f => {
          const link = f.contentDocument?.querySelector<HTMLLinkElement>(`link[data-pd-comp="${componentId}"]`);
          if (link) link.href = href;
        });
      }

      // The content's width may have changed with its CSS: fit the frames to it again, once the swapped
      // stylesheets have loaded (measuring earlier would size the frames to the old CSS).
      void pdLinksLoaded().then(() => {
        // New CSS, new height: a preview clamped as circular gets another chance.
        document.querySelectorAll<HTMLIFrameElement>("#preview-frame, .gallery-item iframe").forEach(resetContentHeight);
        remeasureAll();
      });

      // Refresh relationships panel if the swapped file affects the currently-shown component.
      if (store.local.panelTab === "relationships" && session.current) {
        void fetchDetail(session.current.id)
          .then(d => { if (d) { session.current = d; return renderPanel(); } })
          .catch(() => { /* ignore */ });
      }
    } else if (msg.type === "error") {
      // Surface EVERY error, not just component-scoped ones.
      //
      // The server distinguishes build from render and formats a legible message, and both fields
      // were being discarded: the branch below is gated on componentId, and a build failure carries
      // none. A broken .scss therefore produced nothing in the UI at all — it reached only the
      // dev-server's terminal. For a workbench whose whole job is surfacing defects, silently
      // swallowing its own build errors is the worst possible failure mode.
      renderConsole(`${msg.scope === "build" ? "Build" : "Render"} error — ${msg.message}`, "error");

      const errId = msg.componentId;
      if (errId && errId === session.current?.id) {
        // Server returns 200 + ComponentDetail with RENDER_ERROR diagnostic on render failure.
        void fetchDetail(errId)
          .then(d => {
            if (!d) return;
            session.current = d;
            session.renderedA11y = [];
            session.scanPending = store.local.dock.dockTab === "diagnostics";
            refreshDiagnostics();
            if (store.local.dock.dockTab === "diagnostics") void runRenderedA11yScan();
          })
          .catch(() => {});
      }
    } else if (msg.type === "tree-changed") {
      // A .hbs was added or removed — re-fetch the tree and rebuild the nav.
      void fetch(PD_ROUTES.tree)
        .then(r => r.ok ? r.json() as Promise<ComponentTree> : Promise.reject())
        .then(freshTree => {
          session.tree = freshTree;
          session.componentRegistry.clear();
          (function populate(nodes: TreeNode[]): void {
            for (const n of nodes) {
              if (n.kind === "component") session.componentRegistry.set(n.path, { title: n.title, category: n.path.split("/")[0], visibility: n.visibility as "public" | "private" | undefined, ...(n.source ? { source: n.source } : {}) });
              if (n.children) populate(n.children);
            }
          })(session.tree.roots);
          session.navCategoryOrder = new Map(session.tree.roots.map((r, i) => [r.path, i]));

          // Reconcile stored navOpenPaths against the new tree — drop vanished paths.
          // The store already holds current open-state (toggle listener writes on every open/close).
          const newFolderPaths = extractFolderPaths(session.tree.roots);
          const reconciledPaths = new Set([...store.local.navOpenPaths].filter(p => newFolderPaths.has(p)));
          store.setLocal({ navOpenPaths: reconciledPaths });

          mountSidebar();
          syncPackageControl(session.tree);

          // Restore open state from the reconciled store.
          restoreNavOpenState(store.local.navOpenPaths);

          // Re-open and highlight the active component's nav entry.
          if (session.current?.id) {
            if (session.componentRegistry.has(session.current.id)) {
              setActiveTreeItem(session.current.id);
            } else {
              // Active component was deleted — clear it and return to empty state.
              session.current = null;
              dom.iframe.srcdoc = "";
              dom.singlePreview.hidden = true;
              dom.panel.hidden = true;
            }
          }
          // Re-apply any active search filter to the new tree.
          if (session.searchQuery) filterTree(session.searchQuery);

          // A folder page shows its index.md and a gallery in tree order — both may have changed.
          if (!dom.categoryOverview.hidden && !session.current) {
            const folderPath = routeFromPathname(window.location.pathname).slice(1);
            if (folderPath) void navigateOverview(folderPath);
          }

          // Re-render the relationships facet: usedBy edges may have changed when a
          // component was added or removed. Re-fetch to get the fresh registry, then paint.
          if (session.current?.id && session.componentRegistry.has(session.current.id) && store.local.panelTab === "relationships") {
            void fetchDetail(session.current.id)
              .then(d => { if (d) { session.current = d; return renderPanel(); } })
              .catch(() => {});
          }
        })
        .catch(() => {});
    } else if (msg.type === "collision") {
      // A quarantined component is excluded from the tree, so without this line the author sees a
      // component silently vanish. Name both paths — renaming or moving one of them resolves it.
      renderConsole(
        `Handle collision — "${msg.handle}" is held by ${msg.incumbentPath}; ${msg.quarantinedPath} is quarantined until one is renamed`,
        "error",
      );
    } else if (msg.type === "page-changed") {
      // Storefront pages reload on this; the workbench shows no storefront page, so it ignores it.
    } else {
      // Exhaustiveness: adding an arm to HmrMessage without handling it here is a compile error.
      const unhandled: never = msg;
      void unhandled;
    }
  });
}

/** Resolves when the component stylesheets just swapped into the preview frames have loaded (or
 *  failed), or after a second at most. Only pd-links change on a css-link-swap, so only they are awaited. */
function pdLinksLoaded(): Promise<void> {
  const links = [...document.querySelectorAll<HTMLIFrameElement>("iframe")]
    .flatMap(f => [...(f.contentDocument?.querySelectorAll<HTMLLinkElement>("link[data-pd-comp]") ?? [])]);
  return Promise.all(links.map(link => new Promise<void>(resolve => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    setTimeout(resolve, 1000);
  }))).then(() => undefined);
}
