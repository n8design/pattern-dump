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
import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { parsePartialsFromHbs } from "./hbs-partials.js";
import { designFiles } from "./storefront/design-files.js";
import { frontmatterList, readFrontmatter } from "./frontmatter.js";

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

/** A `requireScript` / `requireAssets` value from a pattern `.md`'s frontmatter, one entry per item. */
export function requiresList(md: string, key: "requireScript" | "requireAssets"): string[] {
  return frontmatterList(readFrontmatter(md), key);
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
      ownScripts = requiresList(md, "requireScript").map(normalizeScriptId);
      ownAssets  = requiresList(md, "requireAssets");
    } catch { /* no .md */ }
  }

  const allScripts = [...ownScripts];
  const allAssets  = [...ownAssets];

  // Recurse into HBS partials.
  const hbsPath = entry?.hbsPath ?? "";
  let hbs = "";
  try { hbs = hbsPath ? await designFiles(discoveryMap).text(hbsPath) : ""; } catch { /* unreadable or missing .hbs — treat as empty markup, not a hard failure */ }

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

/** A symbol set a component needs (`requireAssets: [id]`), as found in the asset folders. */
export interface SvgSet { id: string; svg: string; file: string }

/**
 * Each set `ids` names, in order: `<id>.svg`, then `images/<id>.svg`, in each asset folder in turn, the first that
 * has it winning (the project's folders come before packages', as for symbol images). `missing` lists the ids no
 * folder has.
 */
export async function findSvgSets(ids: readonly string[], assetRoots: readonly string[]): Promise<{ sets: SvgSet[]; missing: string[] }> {
  const sets: SvgSet[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    let found: SvgSet | undefined;
    for (const root of assetRoots) {
      for (const candidate of [`${id}.svg`, `images/${id}.svg`]) {
        const file = join(root, candidate);
        try { found = { id, svg: await readFile(file, "utf-8"), file }; break; } catch { /* try the next */ }
      }
      if (found) break;
    }
    if (found) sets.push(found); else missing.push(id);
  }
  return { sets, missing };
}

/** The sets a preview inlines, hidden with display:none (hideSvg); a set no folder has is left out. */
export async function loadSvgAssets(ids: string[], assetRoots: readonly string[]): Promise<string[]> {
  return (await findSvgSets(ids, assetRoots)).sets.map(s => hideSvg(s.svg));
}

/**
 * A set hidden by its size, for a storefront page: zero width and height, never display:none, which keeps markers
 * and gradients inside it from painting in Chromium and WebKit. The root's own width, height, style, aria-hidden and
 * focusable go first, so the page's are the only ones; an XML declaration or doctype before it goes too.
 */
export function hideSvgBySize(svg: string): string {
  // An XML declaration or a doctype before the root has no place in an HTML body.
  const bare = svg.replace(/^\s*<\?xml[^>]*\?>\s*/i, "").replace(/^\s*<!DOCTYPE[^>]*>\s*/i, "");
  return bare.replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
    const kept = attrs.replace(/\s(?:width|height|style|aria-hidden|focusable)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"${kept}>`;
  });
}

/** Every id a set declares, in order. */
export function svgIds(svg: string): string[] {
  return [...svg.matchAll(/<[A-Za-z][^>]*?\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => m[1] ?? m[2] ?? "");
}

export function hideSvg(svg: string): string {
  // Inject display:none + aria-hidden on the root <svg> element.
  return svg.replace(/<svg(\s|>)/, '<svg$1style="display:none;position:absolute" aria-hidden="true" ');
}

/**
 * Report `requireScript` / `globalScripts` ids that can never resolve, once, at startup — the way
 * project-loaders reports an unreadable helper or a bad _data file. Without this a typo is silent
 * until someone opens the component, where it used to surface as a raw ENOENT inside the preview.
 *
 * Scripts are TypeScript by contract, so an id resolves only as `<scriptsDir>/<id>.ts`. A full URL in
 * globalScripts is loaded by the browser, not compiled, so it is not checked here.
 */
export async function reportUnresolvableScripts(
  discoveryMap: DiscoveryMap,
  scriptsDirs: string[],
  globalScripts: string[],
  cwd: string,
): Promise<void> {
  const resolves = (id: string) => scriptsDirs.some(d => existsSync(join(d, `${id}.ts`)));
  const where = scriptsDirs.length
    ? scriptsDirs.map(d => relative(cwd, d) || d).join(" or ")
    : "no scriptsDir configured";

  for (const id of globalScripts) {
    if (id.includes("://") || resolves(normalizeScriptId(id))) continue;
    console.warn(`[dev-server] globalScripts "${id}": no ${normalizeScriptId(id)}.ts in ${where}`);
  }

  for (const [componentId, entry] of discoveryMap) {
    if (!entry.mdPath) continue;
    let md: string;
    try { md = await readFile(entry.mdPath, "utf-8"); } catch { continue; }
    for (const raw of requiresList(md, "requireScript")) {
      const id = normalizeScriptId(raw);
      if (resolves(id)) continue;
      console.warn(`[dev-server] requireScript "${raw}" on ${componentId}: no ${id}.ts in ${where}`);
    }
  }
}
