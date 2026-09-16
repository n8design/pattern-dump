// requireScript / requireAssets aggregation, and SVG symbol-set loading.
//
// A component declares its own script/asset requirements in .md front matter; this walks the
// component's static include tree and unions the requirements of everything it composes, so a
// preview links what its children need without each component re-declaring it.
//
// Recursion is depth-first over `parsePartialsFromHbs`, with a visited set — a component graph can
// legitimately converge (two parents including one child), and without the guard a cycle would hang
// the render rather than fail it.
//
// Explicit arguments; no server state.

import type { PatternDirs } from "./pattern-dirs.js";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { parsePartialsFromHbs } from "./hbs-partials.js";

// ---- requireScript / requireAssets aggregation ----

export interface ComponentRequires {
  scripts: string[];
  assets: string[];
}

// Normalize a raw requireScript value to a bare basename without path or extension.
// Handles: [toggle] → toggle, scripts/toggle → toggle, toggle.js → toggle.
export function normalizeScriptId(raw: string): string {
  let s = raw.trim().replace(/^\[(.+)\]$/, "$1").trim();
  s = basename(s);
  s = s.replace(/\.(ts|js)$/, "");
  return s;
}

export function parseFrontmatterList(md: string, key: string): string[] {
  const values: string[] = [];
  const re = new RegExp(`^${key}:\\s*(.+)$`, "mg");
  for (const [, val] of md.matchAll(re)) {
    values.push(val.trim());
  }
  return values;
}


export async function aggregateRequires(
  componentId: string,
  patternsDir: PatternDirs,
  flatNameToPath: Map<string, string>,
  discoveryMap: DiscoveryMap,
  visited = new Set<string>()
): Promise<ComponentRequires> {
  if (visited.has(componentId)) return { scripts: [], assets: [] };
  visited.add(componentId);

  const entry = discoveryMap.get(componentId);

  let ownScripts: string[] = [];
  let ownAssets:  string[] = [];

  if (entry?.mdPath) {
    try {
      const md = await readFile(entry.mdPath, "utf-8");
      ownScripts = parseFrontmatterList(md, "requireScript").map(normalizeScriptId);
      ownAssets  = parseFrontmatterList(md, "requireAssets")
        .map(v => v.trim().replace(/^\[(.+)\]$/, "$1").trim());
    } catch { /* no .md */ }
  }

  const allScripts = [...ownScripts];
  const allAssets  = [...ownAssets];

  // Recurse into HBS partials.
  const hbsPath = entry?.hbsPath ?? "";
  let hbs = "";
  try { hbs = hbsPath ? await readFile(hbsPath, "utf-8") : ""; } catch { /* unreadable or missing .hbs — treat as empty markup, not a hard failure */ }

  for (const flatName of parsePartialsFromHbs(hbs)) {
    const childPath = flatNameToPath.get(flatName);
    if (childPath) {
      const child = await aggregateRequires(childPath, patternsDir, flatNameToPath, discoveryMap, visited);
      allScripts.push(...child.scripts);
      allAssets.push(...child.assets);
    }
  }

  // Deduplicate preserving first-occurrence order.
  return {
    scripts: [...new Set(allScripts)],
    assets:  [...new Set(allAssets)],
  };
}

// ---- SVG symbol set loading ----

export async function loadSvgAssets(ids: string[], assetsDir: string): Promise<string[]> {
  const contents: string[] = [];
  for (const id of ids) {
    for (const candidate of [`${id}.svg`, `images/${id}.svg`]) {
      try {
        const raw = await readFile(join(assetsDir, candidate), "utf-8");
        contents.push(hideSvg(raw));
        break;
      } catch { /* try next candidate */ }
    }
  }
  return contents;
}

export function hideSvg(svg: string): string {
  // Inject display:none + aria-hidden on the root <svg> element.
  return svg.replace(/<svg(\s|>)/, '<svg$1style="display:none;position:absolute" aria-hidden="true" ');
}
