// Which source root a watched file is in, by kind: the folder a handler works from, and for a stylesheet
// its root's own base layer. Matched by folder boundary, never by a bare prefix, so `src/patterns-site`
// is not inside `src/patterns`.

import { statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import type { ResolvedConfig } from "./server-config.js";
import { documentBaseMatcher, resolveScssToComponent } from "./style-index.js";

export interface WatchedRoots {
  patterns: string[];
  styles: Array<{ dir: string; inBase: (absPath: string) => boolean }>;
  themes: string[];
  scripts: string[];
  /** Global data folders: their .json is read into one context at startup, and again on a change. */
  data: string[];
  /** Asset folders: served from disk per request, so a change only needs the pages that use them reloaded. */
  assets: string[];
  /** Helpers: `scope` is the folder watched (a helpers folder, or the folder of a single helper file);
   *  `isEntry` names the modules pd dev imports itself, which reload in place. */
  helpers: Array<{ scope: string; isEntry: (absPath: string) => boolean }>;
}

const MODULE = /\.[mc]?js$/;

/** A helpers path as watched: a folder's own modules are its entries; a single file is its own. */
function helperScope(path: string): { scope: string; isEntry: (absPath: string) => boolean } {
  let isDir = false;
  try { isDir = statSync(path).isDirectory(); } catch { /* a missing path: watched as a file's folder */ }
  return isDir
    ? { scope: path, isEntry: p => dirname(p) === path && MODULE.test(extname(p)) && !p.slice(path.length + 1).startsWith(".") }
    : { scope: dirname(path), isEntry: p => p === path };
}

/**
 * The source roots pd dev watches: the project's, and those of every linked package (a `file:`
 * dependency or a workspace, by its real folder), the same kinds for both. An installed copy in
 * node_modules is not watched: it changes by reinstalling, not by editing.
 */
export function watchedRoots(cfg: ResolvedConfig): WatchedRoots {
  const linked = new Map(cfg.packages.filter(p => p.linked).map(p => [p.name, p]));
  const projectStyles = cfg.styleRoots.filter(r => r.source === undefined);
  const packageStyles = cfg.styleRoots.filter(r => r.source !== undefined && linked.has(r.source));
  return {
    patterns: [cfg.patternsDir, ...cfg.patternRoots.filter(r => r.source !== undefined && linked.has(r.source)).map(r => r.dir)],
    styles: [...projectStyles, ...packageStyles].map(r => ({ dir: r.dir, inBase: documentBaseMatcher(r.dir, r.base) })),
    themes: [
      ...(cfg.config.themes?.dir && cfg.themesDir ? [cfg.themesDir] : []),
      ...[...linked.values()].filter(p => p.manifest.themes).map(p => join(p.dir, p.manifest.themes!.dir)),
    ],
    scripts: [
      ...(cfg.config.scriptsDir && cfg.scriptsDirs[0] ? [cfg.scriptsDirs[0]] : []),
      ...[...linked.values()].filter(p => p.manifest.scripts).map(p => join(p.dir, p.manifest.scripts!)),
    ],
    data: [
      ...(cfg.config.dataDir ? [resolve(cfg.cwd, cfg.config.dataDir)] : []),
      ...[...linked.values()].filter(p => p.manifest.data).map(p => join(p.dir, p.manifest.data!)),
    ],
    assets: [
      ...[cfg.config.assets?.dir ?? []].flat().map(d => resolve(cfg.cwd, d)),
      ...[...linked.values()].flatMap(p => (p.manifest.assets ?? []).map(a => join(p.dir, a))),
    ],
    helpers: [
      ...(cfg.config.helpers ? [resolve(cfg.cwd, cfg.config.helpers)] : []),
      ...[...linked.values()].filter(p => p.manifest.helpers).map(p => join(p.dir, p.manifest.helpers!)),
    ].map(helperScope),
  };
}

/** Whether `p` is `dir` or inside it. */
export const within = (dir: string, p: string): boolean => p === dir || p.startsWith(dir + sep);

export function rootMatchers(watched: WatchedRoots) {
  const styleRootOf = (p: string) => watched.styles.find(r => within(r.dir, p));
  return {
    patternRootOf: (p: string): string | undefined => watched.patterns.find(d => within(d, p)),
    styleRootOf,
    themeDirOf: (p: string): string | undefined => watched.themes.find(d => within(d, p)),
    scriptDirOf: (p: string): string | undefined => watched.scripts.find(d => within(d, p)),
    dataDirOf: (p: string): string | undefined => watched.data.find(d => within(d, p)),
    assetRootOf: (p: string): string | undefined => watched.assets.find(d => within(d, p)),
    /** A helper file: an entry pd dev reloads in place, or another file in a helper's folder. */
    helperOf: (p: string): "entry" | "other" | undefined => {
      const h = watched.helpers.filter(x => within(x.scope, p));
      if (!h.length) return undefined;
      return h.some(x => x.isEntry(p)) ? "entry" : "other";
    },
    /** A stylesheet's rules are base-layer CSS: its root's documentBase lists it. */
    inBase: (p: string): boolean => styleRootOf(p)?.inBase(p) ?? false,
    /** The component a stylesheet belongs to, resolved against its own style root. */
    componentOfScss: (p: string, ids: Set<string>): string | null => {
      const root = styleRootOf(p);
      return root ? resolveScssToComponent(p, root.dir, ids) : null;
    },
  };
}
