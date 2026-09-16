// `pd audit` output formatters.
//
// Pure string builders over the shared `AuditRollup` from @pattern-dump/contracts — the same view
// model the workbench's Audit facet renders, so the CLI report and the UI cannot drift.
//
// No I/O, no server state. `formatAudit` and `AuditFormat` are part of the package's public
// contract (packages/core imports both), so index.ts re-exports them.

import { buildAuditRollup, SCOPE_BOUNDARY } from "@pattern-dump/contracts";
import type { AuditRollup, DiagnosticsGraph } from "@pattern-dump/contracts";

/** The `pd audit` output formats. The renderers below serialize the shared `AuditRollup`
 *  (now defined in `@pattern-dump/contracts`, so the workbench facet renders from the same builder). */
export type AuditFormat = "md" | "text" | "json";

/** Markdown renderer — MUST stay byte-identical to the pre-refactor `formatAuditReport` output.
 *  Guarded by a same-graph→same-md regression test. */
function renderAuditMarkdown(r: AuditRollup): string {
  const lines: string[] = [];
  lines.push(`# Diagnostics audit${r.subjectSha ? ` — ${r.subjectSha}` : ""}`);
  lines.push("");
  lines.push(`**${r.headline}**`);
  lines.push("");
  lines.push(`Render outcomes: ${r.renderOutcomes.ok} ok, ${r.renderOutcomes.blank} blank, ${r.renderOutcomes.error} error.`);
  lines.push("");
  lines.push("## Rules by blast radius (components affected; occurrences secondary)");
  lines.push("");
  lines.push("| rule | components | occurrences | tag |");
  lines.push("| --- | ---: | ---: | --- |");
  for (const rule of r.rulesByBlast) {
    lines.push(`| \`${rule.engine}:${rule.ruleId}\` | ${rule.components} | ${rule.occurrences} | ${rule.tags.join(", ")} |`);
  }
  lines.push("");
  lines.push("## Per component");
  lines.push("");
  for (const c of r.perComponent) {
    lines.push(`### ${c.id}  _(render: ${c.render})_`);
    if (c.occurrences.length === 0) lines.push("- (no defects; render outcome noted above)");
    for (const o of c.occurrences) {
      lines.push(`- \`${o.engine}:${o.ruleId}\` **[${o.tag}]** ${o.message}${o.domPath ? ` — \`${o.domPath}\`` : ""}`);
    }
    lines.push("");
  }
  lines.push(SCOPE_BOUNDARY);
  lines.push("");
  return lines.join("\n");
}

/** Plain-text renderer — the same information, markdown stripped; SCOPE_BOUNDARY + headline verbatim. */
function renderAuditText(r: AuditRollup): string {
  const lines: string[] = [];
  lines.push(`Diagnostics audit${r.subjectSha ? ` — ${r.subjectSha}` : ""}`);
  lines.push("");
  lines.push(r.headline);
  lines.push("");
  lines.push(`Render outcomes: ${r.renderOutcomes.ok} ok, ${r.renderOutcomes.blank} blank, ${r.renderOutcomes.error} error.`);
  lines.push("");
  lines.push("Rules by blast radius (components affected; occurrences secondary):");
  if (r.rulesByBlast.length === 0) lines.push("  (none)");
  for (const rule of r.rulesByBlast) {
    lines.push(`  ${rule.engine}:${rule.ruleId} — components ${rule.components}, occurrences ${rule.occurrences} [${rule.tags.join(", ")}]`);
  }
  lines.push("");
  lines.push("Per component:");
  if (r.perComponent.length === 0) lines.push("  (no components with findings or non-ok render)");
  for (const c of r.perComponent) {
    lines.push(`  ${c.id} (render: ${c.render})`);
    if (c.occurrences.length === 0) lines.push("    (no defects; render outcome noted above)");
    for (const o of c.occurrences) {
      lines.push(`    ${o.engine}:${o.ruleId} [${o.tag}] ${o.message}${o.domPath ? ` — ${o.domPath}` : ""}`);
    }
  }
  lines.push("");
  lines.push(r.scope);
  lines.push("");
  return lines.join("\n");
}

/** JSON renderer — the rollup itself (the CI-consumable report shape). Distinct from the raw
 *  bipartite graph JSON, which is persisted separately and reachable via its printed path. */
function renderAuditJson(r: AuditRollup): string {
  return JSON.stringify(r, null, 2);
}

/** Serialize the audit report in the requested format. `md`/`text`/`json` all render one rollup. */
export function formatAudit(graph: DiagnosticsGraph, format: AuditFormat = "md", opts: { subjectSha?: string } = {}): string {
  const rollup = buildAuditRollup(graph, opts);
  return format === "json" ? renderAuditJson(rollup)
    : format === "text" ? renderAuditText(rollup)
    : renderAuditMarkdown(rollup);
}

/** Format the diagnostics graph as the `pd audit` Markdown report: headline, rules sorted by blast
 *  radius (component-count; occurrences secondary), per-component list, and the §0 boundary verbatim.
 *  Retained for back-compat; identical to `formatAudit(graph, "md", opts)`. */
export function formatAuditReport(graph: DiagnosticsGraph, opts: { subjectSha?: string } = {}): string {
  return renderAuditMarkdown(buildAuditRollup(graph, opts));
}

