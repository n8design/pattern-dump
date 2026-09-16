// The Inspector's Audit facet — the corpus diagnostics view.
//
// Selection-INDEPENDENT: it shows the whole corpus, never the selected component, and renders from a
// cached rollup. auditState/auditRollup are module-private; the only way another module changes them
// is clearAuditError(), which is why that function exists rather than the tab handler writing the
// state directly as it used to.

import type { AuditRollup } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { store } from "../core/store.js";
import { fetchAuditRollup, renderAuditView } from "./audit-view.js";

// Selection-independent. Renders from a cached rollup; a `renderPanel()` fired by a selection change
// re-renders from cache (no refetch). A load is kicked only on first open (idle) and by refreshAudit()
// (HMR — Commit 5). The state enum keeps a failed fetch from re-triggering a load on every render.
type AuditState = "idle" | "loading" | "loaded" | "error";
let auditState: AuditState = "idle";
let auditRollup: AuditRollup | null = null;

export async function loadAudit(): Promise<void> {
  auditState = "loading";
  if (store.local.panelTab === "audit") renderAuditFacet(); // show the loading placeholder now
  try {
    auditRollup = await fetchAuditRollup();
    auditState = "loaded";
  } catch {
    auditRollup = null;
    auditState = "error";
  }
  if (store.local.panelTab === "audit") renderAuditFacet(); // render result / error
}

/** Force a reload — facet-open refresh and the HMR hook call this. */
export function refreshAudit(): void { void loadAudit(); }

/**
 * Clear a stuck error so the next render retries.
 *
 * A failed audit is sticky BY DESIGN: renderPanel runs on every navigation, so retrying on render
 * would hammer a failing endpoint once per component change. But reopening the tab is a deliberate
 * user action, and the panel's own copy promises "Reopen the tab to retry" — so the tab handler
 * calls this, and only an `error` is reset. A `loaded` facet still renders from cache.
 *
 * Exists so the auditState write lives with auditState. The tab handler used to mutate it directly,
 * the one place outside this group that did — which would have been a cross-module write the moment
 * the audit facet became its own module.
 */
export function clearAuditError(): void {
  if (auditState === "error") auditState = "idle";
}

export function renderAuditFacet(): void {
  if (auditState === "idle") { void loadAudit(); return; } // first open → kick a load (it renders)
  if (auditState === "loaded" && auditRollup) {
    dom.panelContent.replaceChildren(renderAuditView(auditRollup));
    return;
  }
  dom.panelContent.innerHTML =
    "<section class='audit-panel' aria-label='Corpus diagnostics audit'>" +
    (auditState === "loading"
      ? "<p class='audit-loading'>Loading corpus audit…</p>"
      : "<p class='audit-error'>Corpus audit unavailable. Reopen the tab to retry.</p>") +
    "</section>";
}
