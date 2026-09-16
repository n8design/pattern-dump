// Component detail — the payload behind /api/component/:id.
//
// The widest fan-out in the package: it reaches layout-mode, markdown, css-closure, requires and
// the style index. That direction is one-way by design — NOTHING may import this module, or the
// graph cycles.
//
// Two behaviours worth knowing before editing:
//
//  - VARIANT DOC FALLBACK (one edge, no recursion): a variant with no own .md inherits the BASE
//    component's doc body. Metadata does not inherit — title/description/status stay the variant's.
//    The fallback also fires when the variant's own .md is empty or unreadable, which is
//    indistinguishable from "absent" at this layer, and deliberately so.
//  - The inherited body also lands in `source.md`, so the raw markdown a variant reports is the
//    base's. Pinned by test/docs.spec.ts.

import type { PatternDirs } from "./pattern-dirs.js";
import { readFile } from "node:fs/promises";
import type {
  ComponentDetail, ComponentSource, ComponentStatus, DiscoveryMap,
  RelationshipsAvailable, VariantRef,
} from "@pattern-dump/contracts";
import { highlight, wrapWithCopyButton } from "@pattern-dump/renderer";
import { resolveLayoutMode } from "./layout-mode.js";
import { renderDoc } from "./markdown.js";
import { deriveClassBorrowingFields } from "./css-closure.js";
import { aggregateRequires } from "./requires.js";
import type { CompositionRegistry } from "./composition.js";
import type { ScssModuleGraph, ClassOwnerIndex, BaseProvenanceIndex } from "./style-index.js";

export async function buildComponentDetail(
  componentId: string,
  patternsDir: PatternDirs,
  renderFn: (input: { component: string; variant?: string }) => Promise<{ html: string }>,
  tracker: { css: string },
  defaultTheme?: string,
  flatNameToPath?: Map<string, string>,
  compositionReg?: CompositionRegistry,
  scssGraph?: ScssModuleGraph,
  classOwnerIndex?: ClassOwnerIndex,
  discoveryMap?: DiscoveryMap,
  baseProvenance?: BaseProvenanceIndex
): Promise<ComponentDetail> {
  const parts    = componentId.split("/");
  const name     = parts[parts.length - 1];
  const category = parts[0];
  const entry    = discoveryMap?.get(componentId);

  let title = name;
  let description = "";
  let status: ComponentStatus = "draft";
  let deprecatedUse: string | undefined;
  let rawMd = "";

  if (entry?.mdPath) {
    try {
      rawMd = await readFile(entry.mdPath, "utf-8");
      const t = rawMd.match(/^title:\s*(.+)$/m);
      const d = rawMd.match(/^description:\s*(.+)$/m);
      const s = rawMd.match(/^status:\s*(.+)$/m);
      const u = rawMd.match(/^deprecated-use:\s*(.+)$/m);
      if (t) title       = t[1].trim();
      if (d) description = d[1].trim();
      if (s) {
        const sv = s[1].trim();
        if (sv === "stable" || sv === "deprecated" || sv === "draft") status = sv;
      }
      if (u) deprecatedUse = u[1].trim();
    } catch { /* no .md */ }
  }

  // Variant doc fallback: if this is a variant with no own doc, inherit the base component's doc.
  if (!rawMd && componentId.includes("~")) {
    const baseId = componentId.split("~")[0];
    const baseEntry = discoveryMap?.get(baseId);
    if (baseEntry?.mdPath) {
      try {
        rawMd = await readFile(baseEntry.mdPath, "utf-8");
      } catch { /* base .md unreadable — keep rawMd empty */ }
    }
  }

  const layout = await resolveLayoutMode(componentId, patternsDir, discoveryMap);

  // Derive variants from the discovery map: all ids matching <componentId>~*.
  const variantPrefix = `${componentId}~`;
  const variants: VariantRef[] = discoveryMap
    ? [...discoveryMap.keys()]
        .filter(id => id.startsWith(variantPrefix))
        .map(id => {
          const variantToken = id.slice(variantPrefix.length);
          return { name: variantToken };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const hbsPath = entry?.hbsPath ?? "";
  let hbs = "";
  try { hbs = hbsPath ? await readFile(hbsPath, "utf-8") : ""; } catch { /* missing */ }
  const hbsHighlighted = wrapWithCopyButton(highlight(hbs, "handlebars"), hbs);

  let jsonStr: string | undefined;
  let jsonHighlighted: string | undefined;
  if (entry?.jsonPath) {
    try {
      jsonStr = await readFile(entry.jsonPath, "utf-8");
      jsonHighlighted = wrapWithCopyButton(highlight(jsonStr, "json"), jsonStr);
    } catch { /* no .json */ }
  }

  // schemaPath is set by discovery — no fallback to path reconstruction.
  let schemaStr: string | undefined;
  let schemaHighlighted: string | undefined;
  if (entry?.schemaPath) {
    try {
      schemaStr = await readFile(entry.schemaPath, "utf-8");
      schemaHighlighted = wrapWithCopyButton(highlight(schemaStr, "json"), schemaStr);
    } catch { /* no .schema.json */ }
  }

  const source: ComponentSource = {
    hbs,
    hbsHighlighted,
    ...(jsonStr !== undefined ? { json: jsonStr, jsonHighlighted } : {}),
    ...(schemaStr !== undefined ? { schema: schemaStr, schemaHighlighted } : {}),
    ...(rawMd ? { md: rawMd } : {}),
  };

  const stripFrontmatter = rawMd.replace(/^---[\s\S]*?---\n?/, "").trim();
  const doc = stripFrontmatter
    ? await renderDoc(
        stripFrontmatter,
        (id, variant) => renderFn({ component: id, variant }).then(r => r.html),
        discoveryMap ?? new Map()
      )
    : undefined;

  // Aggregate requireScript / requireAssets from this component and its composed descendants.
  let requireScripts: string[] | undefined;
  let requireAssets: string[] | undefined;
  if (flatNameToPath && discoveryMap) {
    const requires = await aggregateRequires(componentId, patternsDir, flatNameToPath, discoveryMap);
    if (requires.scripts.length) requireScripts = requires.scripts;
    if (requires.assets.length)  requireAssets  = requires.assets;
  }

  const classBorrowing = classOwnerIndex
    ? deriveClassBorrowingFields(hbs, componentId, classOwnerIndex, baseProvenance)
    : { styleUses: [], styleModules: [], inlineStyles: false, utilityClasses: false, unattributedClasses: [] };

  const relationships: RelationshipsAvailable = {
    available: true,
    uses:               compositionReg?.uses.get(componentId)         ?? [],
    usedBy:             compositionReg?.usedBy.get(componentId)        ?? [],
    styleUses:          classBorrowing.styleUses,
    styleUsesModules:   scssGraph?.styleUsesModules.get(componentId)   ?? [],
    styleModules:       classBorrowing.styleModules,
    inlineStyles:       classBorrowing.inlineStyles,
    utilityClasses:     classBorrowing.utilityClasses,
    unattributedClasses: classBorrowing.unattributedClasses,
  };

  return {
    id: componentId,
    title,
    description,
    category,
    status,
    layout,
    ...(deprecatedUse ? { deprecatedUse } : {}),
    variants,
    source,
    doc,
    ...(requireScripts ? { requireScripts } : {}),
    ...(requireAssets  ? { requireAssets  } : {}),
    relationships,
    diagnostics: [],  // populated by the HTTP handler after render()
  };
}
