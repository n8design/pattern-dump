// The Console dock's Diagnostics tab.
//
// Groups findings by category then severity, paints the list, and drives the tab's severity marker.
//
// refreshDiagnostics is the ONE choke point every diagnostic-refresh site funnels through —
// navigation, variant swap, HMR, and the a11y scan completing all call it rather than painting
// directly. Keep it that way: a second painting path is how the structural and rendered tiers drift
// out of sync.
//
// The marker is honest by construction: session.renderedA11y is reset to [] on every
// nav/variant/HMR/open, so before a scan completes the marker reflects STRUCTURAL findings only and
// never shows a false all-clear. The a11y count folds in when the scan finishes and re-refreshes.

import type { Diagnostic, A11yDiagnostic } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { SEVERITY_ORDER, CATEGORY_ORDER, diagSevLabel, diagSep, diagDocsLink, categoryFromSource } from "./diag-format.js";
import { severityGlyph } from "./severity.js";
import { svgIcon } from "../icons/index.js";


export function renderDiagnostics(diagnostics: Diagnostic[]): void {
  dom.diagnosticsEl.innerHTML = "";
  if (diagnostics.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No issues found";
    dom.diagnosticsEl.appendChild(p);
    return;
  }
  // Group by category.
  const groups = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const cat = categoryFromSource(d.source);
    const list = groups.get(cat) ?? [];
    list.push(d);
    groups.set(cat, list);
  }
  // Build one A11Y <li> (shared by confirmed and review rendering).
  function buildA11yLi(d: A11yDiagnostic): HTMLLIElement {
    const li = document.createElement("li");
    li.dataset.severity = d.severity;
    li.dataset.kind = d.kind;
    li.dataset.ruleId = d.ruleId;
    if (d.needsReview) li.dataset.needsReview = "true";
    // Needs-review: show reason string without a severity label — the label means "axe confirmed
    // this", which contradicts both the "could not determine" heading and the 0·N count (D3a).
    if (d.needsReview) {
      li.appendChild(document.createTextNode(d.message));
    } else {
      li.appendChild(diagSevLabel(d.severity));
      li.appendChild(diagSep());
      li.appendChild(document.createTextNode(d.message));
    }
    const ruleSpan = document.createElement("span");
    ruleSpan.className = "pd-a11y-rule";
    ruleSpan.textContent = ` — ${d.ruleId}`;
    li.appendChild(ruleSpan);
    if (d.target) {
      const targetSpan = document.createElement("span");
      targetSpan.className = "pd-a11y-target";
      targetSpan.textContent = ` (${d.target})`;
      li.appendChild(targetSpan);
    }
    li.appendChild(diagDocsLink(d.helpUrl));
    if (d.contrast) {
      const c = d.contrast;
      const swatches = document.createElement("span");
      swatches.className = "pd-contrast-swatches";
      const fgSwatch = document.createElement("span");
      fgSwatch.className = "pd-swatch";
      fgSwatch.style.setProperty("--swatch-color", c.fg);
      fgSwatch.title = c.fg;
      const bgSwatch = document.createElement("span");
      bgSwatch.className = "pd-swatch";
      bgSwatch.style.setProperty("--swatch-color", c.bg);
      bgSwatch.title = c.bg;
      const ratioSpan = document.createElement("span");
      ratioSpan.className = "pd-contrast-ratio";
      ratioSpan.textContent = ` ${c.ratio.toFixed(2)}:1 (needs ${c.expected}:1)`;
      swatches.append(fgSwatch, bgSwatch, ratioSpan);
      li.appendChild(swatches);
    }
    // Per-row severity dot (mixed groups only, CSS-gated). Not on needs-review rows — those carry
    // no severity badge (axe "could not determine"), so no ●/▲ either.
    if (!d.needsReview) li.insertAdjacentHTML("afterbegin", severityGlyph(d.severity));
    return li;
  }

  const sortBySeverity = (arr: Diagnostic[]) =>
    [...arr].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  // Tie-break groups within a severity tier by the canonical order (unknown → last).
  const catRank = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };

  // Per-group split + severity counts (the counts mirror updateTabMarkers' error/warning tally).
  // Confirmed = the counted set: a11y excludes axe "incomplete"/needs-review (certainty axis, D3);
  // other categories count all items. worstRank ranks the group for ordering.
  const ordered = [...groups.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([cat, items]) => {
      const isA11y = cat === "A11y";
      const needsReview = (d: Diagnostic) => d.kind === "A11Y" && d.needsReview === true;
      const confirmed = isA11y ? items.filter(d => !needsReview(d)) : items;
      const review    = isA11y ? items.filter(needsReview) : [];
      const errorCount   = confirmed.filter(d => d.severity === "error").length;
      const warningCount = confirmed.filter(d => d.severity === "warning").length;
      // Empty confirmed (e.g. a11y all-review) ranks last but still renders.
      const worstRank = confirmed.reduce((m, d) => Math.min(m, SEVERITY_ORDER[d.severity] ?? 9), 9);
      return { cat, items, isA11y, confirmed, review, errorCount, warningCount, worstRank };
    })
    // Worst-severity-first (error-groups → warning-groups → clean), stable category tie-break within
    // a tier so groups don't shuffle unpredictably as findings are fixed — only their tier moves them.
    .sort((a, b) => a.worstRank - b.worstRank || catRank(a.cat) - catRank(b.cat));

  // Render as an exclusive accordion (native <details name="pd-diagnostics">).
  for (const { cat, isA11y, confirmed, review, errorCount, warningCount } of ordered) {
    const mixed = errorCount > 0 && warningCount > 0;

    const details = document.createElement("details");
    details.name = "pd-diagnostics";
    if (mixed) details.dataset.mixed = "true"; // gates the dual head marker + per-row dots

    const summary = document.createElement("summary");
    // Head: category label + severity marker(s) — the head's count display, ONE construction shared
    // with the tab via severityGlyph. Uniform group → a single ● N / ▲ N segment; mixed → ● N ▲ M
    // (error then warning). Each segment carries the severity colour onto its count via currentcolor;
    // the glyph paints itself. Severity is the ONLY colour in the head.
    summary.appendChild(document.createTextNode(cat));
    const headSeg = (sev: "error" | "warning", n: number) =>
      `<span class="pd-diag-head-seg" data-severity="${sev}">${severityGlyph(sev)}<span class="pd-diag-head-count">${n}</span></span>`;
    let markerHtml = "";
    if (errorCount > 0)   markerHtml += headSeg("error", errorCount);
    if (warningCount > 0) markerHtml += headSeg("warning", warningCount);
    if (markerHtml) summary.insertAdjacentHTML("beforeend", markerHtml);

    // A11y needs-review is a certainty axis, not severity — a quiet muted clause. Show confirmed 0
    // explicitly when no severity marker is present so "0 · N to review" stays honest (D6).
    if (isA11y && review.length > 0) {
      const rev = document.createElement("span");
      rev.className = "pd-diag-head-review";
      rev.textContent = confirmed.length === 0
        ? ` 0 · ${review.length} to review`
        : ` · ${review.length} to review`;
      summary.appendChild(rev);
    }

    const diagCaret = document.createElement("span");
    diagCaret.className = "disclosure-caret";
    diagCaret.setAttribute("aria-hidden", "true");
    diagCaret.innerHTML = svgIcon("chevron");
    summary.prepend(diagCaret);
    details.appendChild(summary);

    const ul = document.createElement("ul");

    for (const d of sortBySeverity(confirmed)) {
      if (d.kind === "A11Y") {
        ul.appendChild(buildA11yLi(d));
      } else {
        const li = document.createElement("li");
        li.dataset.severity = d.severity;
        li.dataset.kind = d.kind;
        li.appendChild(diagSevLabel(d.severity));
        li.appendChild(diagSep());
        let text = d.message;
        if (d.path) text += ` (path: ${d.path})`;
        if (d.location) {
          const loc = [d.location.file, d.location.line, d.location.column]
            .filter(v => v !== undefined).join(":");
          if (loc) text += ` (at ${loc})`;
        }
        li.appendChild(document.createTextNode(text));
        // Per-row severity dot (shared .pd-sev-glyph); shown only in mixed groups (CSS-gated).
        li.insertAdjacentHTML("afterbegin", severityGlyph(d.severity));
        ul.appendChild(li);
      }
    }

    details.appendChild(ul);

    if (review.length > 0) {
      const reviewDetails = document.createElement("details");
      // No name attribute — must NOT join the pd-diagnostics exclusive group.
      // A shared name would make opening this close its own parent A11y category.
      const reviewSummary = document.createElement("summary");
      reviewSummary.className = "pd-a11y-review-header";
      reviewSummary.textContent = `Needs review (${review.length})`;
      const reviewCaret = document.createElement("span");
      reviewCaret.className = "disclosure-caret";
      reviewCaret.setAttribute("aria-hidden", "true");
      reviewCaret.innerHTML = svgIcon("chevron");
      reviewSummary.prepend(reviewCaret);
      reviewDetails.appendChild(reviewSummary);
      const reviewUl = document.createElement("ul");
      for (const d of sortBySeverity(review)) {
        if (d.kind === "A11Y") reviewUl.appendChild(buildA11yLi(d));
      }
      reviewDetails.appendChild(reviewUl);
      // Open by default when there are no confirmed findings so the only content isn't buried.
      if (confirmed.length === 0) reviewDetails.open = true;
      details.appendChild(reviewDetails);
    }

    dom.diagnosticsEl.appendChild(details);
  }
}

export function refreshDiagnostics(): void {
  if (session.scanPending) {
    const structural = session.current?.diagnostics ?? [];
    if (structural.length > 0) {
      renderDiagnostics(structural);
      const p = document.createElement("p");
      p.className = "pd-a11y-pending";
      p.textContent = "running rendered checks…";
      dom.diagnosticsEl.appendChild(p);
    } else {
      // Structurally clean: suppress all-clear entirely while scan is in flight.
      dom.diagnosticsEl.innerHTML = "";
      const p = document.createElement("p");
      p.className = "pd-a11y-pending";
      p.textContent = "running rendered checks…";
      dom.diagnosticsEl.appendChild(p);
    }
  } else {
    renderDiagnostics([...(session.current?.diagnostics ?? []), ...session.renderedA11y]);
  }
  // The Diagnostics-tab severity marker rides the same merged set as the panel. This is the ONE
  // choke point every diagnostic-refresh site funnels through (nav :1138, variant :1177, HMR :2227,
  // and the a11y scan-complete finally :2093), so no new subscription framework is needed.
  updateTabMarkers();
}

// v1 = Diagnostics tab only. Highest-severity-wins single marker:
// any error → red ● ; warnings & zero errors → orange △ ; zero of both → no marker. Count = the
// winning severity's count. Three channels: colour (data-severity → CSS), count+shape (visible,
// aria-hidden), and the spoken aria-label. Honesty: renderedA11y is reset to [] at every
// nav/variant/HMR/open, so before a scan it's empty and the marker is STRUCTURAL-only (eager),
// never a false all-clear — the a11y count folds in when the scan completes and re-refreshes.
export function updateTabMarkers(): void {
  const tab = document.getElementById("dock-tab-diagnostics");
  if (!tab) return;

  const merged: Diagnostic[] = [...(session.current?.diagnostics ?? []), ...session.renderedA11y];
  let errors = 0;
  let warnings = 0;
  for (const d of merged) {
    // Match the panel headline: unconfirmed a11y (axe "incomplete") is "to review", not counted.
    if (d.kind === "A11Y" && d.needsReview === true) continue;
    if (d.severity === "error") errors++;
    else if (d.severity === "warning") warnings++;
  }

  const marker = tab.querySelector(".tab-marker");
  const countEl = tab.querySelector(".tab-marker-count");
  // Glyph comes from the shared builder (single source: severityGlyph → .pd-sev-glyph). Rebuild it
  // each refresh, before the count, so the marker reads ● N / ▲ N exactly as the static markup did.
  marker?.querySelector(".pd-sev-glyph")?.remove();
  if (errors > 0) {
    tab.dataset.severity = "error";
    tab.dataset.count = String(errors);
    if (countEl) countEl.textContent = String(errors);
    marker?.insertAdjacentHTML("afterbegin", severityGlyph("error"));
  } else if (warnings > 0) {
    tab.dataset.severity = "warning";
    tab.dataset.count = String(warnings);
    if (countEl) countEl.textContent = String(warnings);
    marker?.insertAdjacentHTML("afterbegin", severityGlyph("warning"));
  } else {
    delete tab.dataset.severity;
    delete tab.dataset.count;
    if (countEl) countEl.textContent = "";
  }

  // Spoken counts override the "Diagnostics" text node; omit zero clauses naturally.
  const clauses: string[] = [];
  if (errors > 0) clauses.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  if (warnings > 0) clauses.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  if (clauses.length > 0) {
    tab.setAttribute("aria-label", `Diagnostics, ${clauses.join(", ")}`);
  } else {
    tab.removeAttribute("aria-label");
  }
}
