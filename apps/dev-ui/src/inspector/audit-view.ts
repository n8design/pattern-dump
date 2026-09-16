// Corpus diagnostics audit view — the right-panel Audit facet.
//
// VIEW ONLY. Fetches the shipped bipartite graph from GET /api/audit and renders the SHARED
// `buildAuditRollup` (from @pattern-dump/contracts — the same builder the `pd audit` CLI uses, so the
// two never drift). No detection, no derivation here: the rollup is computed by the one builder; this
// module is a DOM renderer over it.
//
// Selection-INDEPENDENT: the facet shows the whole corpus, never the selected component. It stays
// mounted across component navigation and only refetches on open / on an HMR content change (Commit 5).

import type { AuditResponse, AuditRollup } from "@pattern-dump/contracts";
import { buildAuditRollup, PD_ROUTES } from "@pattern-dump/contracts";
import { routeHref, runtime } from "../core/runtime.js";

// NOTE on severity: the shipped `AuditRollup` deliberately does NOT carry per-occurrence severity
// (buildAuditRollup drops it from rulesByBlast/perComponent — the CLI report is blast-radius + tag
// oriented, not severity-oriented). So this corpus facet is severity-agnostic and does not reuse
// `severityGlyph`; that reuse only applies where the source shape exposes severity (the per-component
// panel). Rendering faithfully = rendering exactly what the rollup carries.
//
// FUTURE (gated on demand, not built): surfacing errors-vs-warnings in the corpus view would be an
// `AuditRollup` extension — add a severity field/rollup in buildAuditRollup (contracts). Cost: it adds
// a field to the rollup, which is the `pd audit --format json` contract, so it needs its own byte-shape
// guard alongside the md snapshot. OPEN QUESTION first: blast radius (component-count) is already the
// honest corpus metric, so severity may belong only in the per-component view — decide the value before
// paying the contract cost.

/** Fetch the graph and build the rollup with the shared builder. Throws on a non-ok response. */
export async function fetchAuditRollup(): Promise<AuditRollup> {
  const res = await fetch(PD_ROUTES.audit);
  if (!res.ok) throw new Error(`audit fetch failed: ${res.status}`);
  const graph = (await res.json()) as AuditResponse;
  return buildAuditRollup(graph, graph.subjectSha ? { subjectSha: graph.subjectSha } : {});
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** `[SUBJECT-DEBT]` / `[PD-GAP]` badge — the attribution that makes a corpus number defensible. */
function tagBadge(tag: string): HTMLSpanElement {
  const s = el("span", "audit-tag", `[${tag}]`);
  s.dataset.tag = tag;
  return s;
}

/** A navigable component id → real `<a href>` to the SPA component route. The route is `/<id>` (the
 *  same path the nav tree links use); `/component/<id>` is the API path, NOT the route. SPA
 *  interception is wired in main.ts; on its own the link still lands correctly via a full nav.
 *  Links navigate; never a button. */
function componentLink(id: string): HTMLAnchorElement {
  const a = el("a", "audit-link", id);
  a.href = routeHref(`/${id.split("/").map(encodeURIComponent).join("/")}`);
  return a;
}

/** Render the rollup into a fresh section element. Pure DOM construction (no innerHTML with
 *  finding text — messages/ids are arbitrary subject content, set via textContent). */
export function renderAuditView(rollup: AuditRollup): HTMLElement {
  const section = el("section", "audit-panel");
  section.setAttribute("aria-label", "Corpus diagnostics audit");

  // Headline (the honest claim) + subject sha when pinned.
  const head = el("header", "audit-head");
  head.appendChild(el("p", "audit-headline", rollup.headline));
  if (rollup.subjectSha) head.appendChild(el("p", "audit-sha", rollup.subjectSha));
  // A static build carries the audit as of the build, not as of now — say so.
  if (runtime.mode === "static") {
    head.appendChild(el("p", "audit-sha", `Snapshot from ${new Date(runtime.builtAt).toLocaleString()}`));
  }
  section.appendChild(head);

  // Totals + render-outcome rollup.
  const t = rollup.totals, ro = rollup.renderOutcomes;
  const totals = el("dl", "audit-totals");
  const stat = (label: string, value: string): void => {
    totals.appendChild(el("dt", "audit-stat-label", label));
    totals.appendChild(el("dd", "audit-stat-value", value));
  };
  stat("Components", String(t.components));
  stat("Affected", String(t.affected));
  stat("Clean", `${t.cleanPct}%`);
  stat("Defects", String(t.defects));
  stat("Render", `${ro.ok} ok · ${ro.blank} blank · ${ro.error} error`);
  section.appendChild(totals);

  // Rule → components pivot (blast radius; already sorted by the builder).
  section.appendChild(el("h3", "audit-h", "Rules by blast radius"));
  if (rollup.rulesByBlast.length === 0) {
    section.appendChild(el("p", "audit-empty", "No rule findings."));
  } else {
    const ul = el("ul", "audit-rules");
    for (const r of rollup.rulesByBlast) {
      const li = el("li", "audit-rule");
      li.appendChild(el("code", "audit-rule-id", `${r.engine}:${r.ruleId}`));
      li.appendChild(el("span", "audit-rule-count", `${r.components} component${r.components === 1 ? "" : "s"} · ${r.occurrences} occ`));
      for (const tag of r.tags) li.appendChild(tagBadge(tag));
      ul.appendChild(li);
    }
    section.appendChild(ul);
  }

  // Component → rules pivot (only components with findings or a non-ok render — the builder filters).
  section.appendChild(el("h3", "audit-h", "Per component"));
  if (rollup.perComponent.length === 0) {
    section.appendChild(el("p", "audit-empty", "No components with findings or a non-ok render."));
  } else {
    const ul = el("ul", "audit-components");
    for (const c of rollup.perComponent) {
      const li = el("li", "audit-component");
      const cHead = el("div", "audit-component-head");
      cHead.appendChild(componentLink(c.id));
      if (c.render !== "ok") {
        const r = el("span", "audit-render", c.render);
        r.dataset.render = c.render;
        cHead.appendChild(r);
      }
      li.appendChild(cHead);

      const findings = el("ul", "audit-findings");
      for (const o of c.occurrences) {
        const f = el("li", "audit-finding");
        f.appendChild(el("code", "audit-finding-rule", `${o.engine}:${o.ruleId}`));
        f.appendChild(tagBadge(o.tag));
        f.appendChild(el("span", "audit-finding-msg", o.message));
        if (o.domPath) f.appendChild(el("code", "audit-finding-path", o.domPath));
        findings.appendChild(f);
      }
      li.appendChild(findings);
      ul.appendChild(li);
    }
    section.appendChild(ul);
  }

  // Scope boundary — NOT optional. The number is only honest next to what it excludes. Collapsible,
  // open by default so the caveat is seen. Raw §0 text (pre-wrap), no markdown parser needed.
  const scope = el("details", "audit-scope");
  scope.open = true;
  scope.appendChild(el("summary", "audit-scope-summary", "Scope — what this count does and does not cover"));
  scope.appendChild(el("pre", "audit-scope-body", rollup.scope));
  section.appendChild(scope);

  return section;
}
