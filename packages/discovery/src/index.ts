import { readdir } from "node:fs/promises";
import { join, basename, dirname, relative } from "node:path";
import type {
  DiscoveryEntry, DiscoveryResult, CollisionEntry, OverrideEntry, PatternRoot,
} from "@pattern-dump/contracts";

export type { PatternRoot };

/**
 * Glob → RegExp over forward-slash relative paths: `**` spans folders, `*` stays within one, `?` is
 * one character. `**\/x` also matches `x` at the top. Deliberately tiny — no dependency.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${re}$`);
}

/**
 * The collapse rule — the ONE implementation of pattern identity's folder-named-leaf case:
 * a `<dir>/<dir>` leaf IS the folder (`atoms/avatar/avatar` → `atoms/avatar`). Discovery owns
 * this; read sites (e.g. the dev-server's scss→component resolver) call it rather than
 * re-deriving an id and diverging. `relNoExt` is a component path without extension.
 */
export function collapseComponentId(relNoExt: string): string {
  const stem = basename(relNoExt);
  const parent = dirname(relNoExt);
  return stem === basename(parent) ? parent : relNoExt;
}

/**
 * The dash handle for a slash id: `<category>-<last-id-segment>` (intermediate folders dropped; `~`
 * preserved for variants). The ONE implementation — `buildDiscoveryMap` builds `handleMap` with this,
 * and export's include-rewrite keys its map on it, so the two cannot drift. `molecules/quick-links/
 * ql-list-button` → `molecules-ql-list-button`.
 *
 * Numeric ordering prefixes are dropped from both parts, as PatternLab's partial names drop them:
 * `00-atoms/01-global/00-colors` → `atoms-colors`. They order the tree; the id and route keep them.
 */
export function deriveHandle(id: string): string {
  const parts = id.split("/");
  const unnumbered = (seg: string) => seg.replace(/^\d+[-_]/, "");
  return `${unnumbered(parts[0])}-${unnumbered(parts[parts.length - 1])}`;
}

/**
 * Discover every component under one patterns folder, or several (the project first, then pattern
 * packages). Ids and handles do not depend on which root a component comes from, so a project
 * template includes a package's component by the same handle the package itself uses.
 *
 * Precedence: roots are processed in order and each root's files in sorted-path order. A handle
 * already held by an EARLIER root is an override (the earlier one stays, the later is recorded in
 * `overrides`); a handle held by the SAME root is a collision (quarantined, as before).
 */
export async function buildDiscoveryMap(roots: string | PatternRoot[]): Promise<DiscoveryResult> {
  const rootList: PatternRoot[] = typeof roots === "string" ? [{ dir: roots }] : roots;
  // Collect all .hbs files from category directories (depth ≥ 1 from each root).
  // Sorted per root for deterministic sorted-path incumbent selection on handle collisions.
  const allHbsFiles: string[] = [];
  const allVarJsonFiles: string[] = [];
  /** absolute file → the root it was found under, and that root's position. */
  const rootOf = new Map<string, { root: PatternRoot; index: number }>();

  for (const [index, root] of rootList.entries()) {
    const excludes = (root.exclude ?? []).map(globToRegExp);
    const excluded = (abs: string, isDir: boolean): boolean => {
      if (!excludes.length) return false;
      const rel = relative(root.dir, abs).split("\\").join("/");
      return excludes.some(re => re.test(rel) || (isDir && re.test(`${rel}/`)));
    };
    const hbs: string[] = [];
    const varJson: string[] = [];
    const collectFiles = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const full = join(dir, e.name);
        if (excluded(full, e.isDirectory())) continue;
        if (e.isDirectory()) {
          await collectFiles(full);
        } else if (e.name.endsWith(".hbs")) {
          hbs.push(full);
        } else if (e.name.includes("~") && e.name.endsWith(".json")) {
          varJson.push(full);
        }
      }
    };
    const topEntries = await readdir(root.dir, { withFileTypes: true }).catch(() => []);
    for (const e of topEntries) {
      const full = join(root.dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".") && !excluded(full, true)) await collectFiles(full);
    }
    hbs.sort();
    varJson.sort();
    for (const f of [...hbs, ...varJson]) rootOf.set(f, { root, index });
    allHbsFiles.push(...hbs);
    allVarJsonFiles.push(...varJson);
  }
  const rootDir = (abs: string): string => rootOf.get(abs)!.root.dir;

  // Pre-fetch directory file listings for sidecar matching.
  const dirFileSets = new Map<string, Set<string>>();
  const allDirs = new Set([...allHbsFiles, ...allVarJsonFiles].map(fp => dirname(fp)));
  await Promise.all([...allDirs].map(async dir => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    dirFileSets.set(dir, new Set(entries.filter(e => !e.isDirectory()).map(e => e.name)));
  }));

  const discoveryMap = new Map<string, DiscoveryEntry>();
  const handleMap = new Map<string, string>();
  const collisions: CollisionEntry[] = [];
  const overrides: OverrideEntry[] = [];

  // Derive slash id: apply the shared collapse rule — <dir>/<dir>.hbs → <dir>.
  function deriveId(absPath: string): string {
    return collapseComponentId(relative(rootDir(absPath), absPath).replace(/\.hbs$/, "")); // e.g. "atoms/button/button" → "atoms/button"
  }

  // dash handle: <category>-<last-id-segment> (intermediate folders dropped; ~ preserved for variants).
  // Module-level `deriveHandle` is the single source of truth (shared with export's rewrite map).

  // Build a DiscoveryEntry from an .hbs file path, resolving sidecars by exact stem match.
  function buildEntry(absPath: string): DiscoveryEntry {
    const dir = dirname(absPath);
    const stem = basename(absPath, ".hbs"); // "button" or "button~save"
    const fileSet = dirFileSets.get(dir) ?? new Set<string>();
    const source = rootOf.get(absPath)?.root.source;
    return {
      ...(source ? { source } : {}),
      hbsPath:    absPath,
      jsonPath:   fileSet.has(`${stem}.json`)        ? join(dir, `${stem}.json`)        : undefined,
      mdPath:     fileSet.has(`${stem}.md`)          ? join(dir, `${stem}.md`)          : undefined,
      schemaPath: fileSet.has(`${stem}.schema.json`) ? join(dir, `${stem}.schema.json`) : undefined,
      ownMarkup:  true,
    };
  }

  // Register a component: collision → quarantine; otherwise add to both maps.
  function registerEntry(id: string, entry: DiscoveryEntry, absPath: string) {
    const handle = deriveHandle(id);
    if (handleMap.has(handle)) {
      const incumbentId = handleMap.get(handle)!;
      const incumbentPath = discoveryMap.get(incumbentId)!.hbsPath;
      const incumbentRoot = rootOf.get(incumbentPath)?.index ?? 0;
      const newcomerRoot = rootOf.get(absPath)?.index ?? 0;
      if (newcomerRoot > incumbentRoot) {
        overrides.push({
          handle, id: incumbentId, path: incumbentPath,
          shadowedPath: absPath, shadowedSource: rootOf.get(absPath)!.root.source ?? "",
        });
        return;
      }
      collisions.push({ handle, incumbentId, incumbentPath, quarantinedPath: absPath, quarantinedId: id });
      return;
    }
    discoveryMap.set(id, entry);
    handleMap.set(handle, id);
  }

  // ---- Pass 1: non-variant .hbs files ----
  for (const absPath of allHbsFiles) {
    if (basename(absPath, ".hbs").includes("~")) continue; // variants handled below
    registerEntry(deriveId(absPath), buildEntry(absPath), absPath);
  }

  // ---- Pass 2: variant .hbs files (grouped by their base id) ----
  const variantHbsByBase = new Map<string, string[]>(); // baseId → sorted variantAbsPaths
  for (const absPath of allHbsFiles) {
    const stem = basename(absPath, ".hbs");
    if (!stem.includes("~")) continue;
    const dir = dirname(absPath);
    const baseStem = stem.split("~")[0];
    const relBase = relative(rootDir(absPath), join(dir, baseStem));
    const parentRel = dirname(relBase);
    const baseId = (baseStem === basename(parentRel)) ? parentRel : relBase;
    const arr = variantHbsByBase.get(baseId) ?? [];
    arr.push(absPath);
    variantHbsByBase.set(baseId, arr);
  }

  for (const [baseId, varPaths] of variantHbsByBase) {
    const hasBase = discoveryMap.has(baseId);

    if (!hasBase) {
      // Base-less: synthesize a placeholder base node.
      // Check for a sidecar .md (e.g. badge.md) so the nav tree shows a proper title.
      const variantTokens = varPaths.map(fp => basename(fp, ".hbs").split("~")[1]);
      const handle = deriveHandle(baseId);
      if (!handleMap.has(handle)) {
        const varDir = dirname(varPaths[0]);
        const baseName = basename(varPaths[0], ".hbs").split("~")[0];
        const fileSet = dirFileSets.get(varDir) ?? new Set<string>();
        const mdPath = fileSet.has(`${baseName}.md`) ? join(varDir, `${baseName}.md`) : undefined;
        const source = rootOf.get(varPaths[0])?.root.source;
        discoveryMap.set(baseId, { ...(source ? { source } : {}), hbsPath: "", ownMarkup: false, variants: variantTokens, mdPath });
        handleMap.set(handle, baseId);
      }
    }

    // Register each own-markup variant .hbs regardless of whether base existed.
    for (const absPath of varPaths) {
      const stem = basename(absPath, ".hbs"); // e.g. "spinner~small"
      const variantToken = stem.split("~")[1];
      const variantId = `${baseId}~${variantToken}`;
      const variantHandle = `${deriveHandle(baseId)}~${variantToken}`;
      if (!handleMap.has(variantHandle)) {
        discoveryMap.set(variantId, buildEntry(absPath));
        handleMap.set(variantHandle, variantId);
      }
    }
  }

  // ---- Pass 3: data-overlay variant .json files (no matching .hbs sibling) ----
  for (const jsonPath of allVarJsonFiles) {
    const jsonStem = basename(jsonPath, ".json"); // e.g. "chip~danger"
    const parts = jsonStem.split("~");
    const baseName = parts[0];
    const variantToken = parts[1];
    const dir = dirname(jsonPath);
    const relBase = relative(rootDir(jsonPath), join(dir, baseName));
    const parentRel = dirname(relBase);
    const baseId = (baseName === basename(parentRel)) ? parentRel : relBase;
    const variantId = `${baseId}~${variantToken}`;

    if (discoveryMap.has(variantId)) continue; // already registered as own-markup

    const baseEntry = discoveryMap.get(baseId);
    if (!baseEntry?.hbsPath) continue; // no base to overlay on

    const variantHandle = `${deriveHandle(baseId)}~${variantToken}`;
    if (!handleMap.has(variantHandle)) {
      const source = rootOf.get(jsonPath)?.root.source;
      discoveryMap.set(variantId, { ...(source ? { source } : {}), hbsPath: baseEntry.hbsPath, jsonPath, ownMarkup: false });
      handleMap.set(variantHandle, variantId);
    }
  }

  // Reverse index: absPath → slash id (for O(1) HMR file-change resolution).
  const hbsPathToId = new Map<string, string>();
  for (const [id, entry] of discoveryMap) {
    if (entry.hbsPath) hbsPathToId.set(entry.hbsPath, id);
  }

  // Quarantine map: quarantinedId → CollisionEntry (for 200+diagnostic on quarantined detail requests).
  const quarantineMap = new Map<string, CollisionEntry>();
  for (const col of collisions) {
    quarantineMap.set(col.quarantinedId, col);
  }

  return { discoveryMap, handleMap, collisions, hbsPathToId, quarantineMap, overrides };
}
