// Which source root a watched file is in, by kind: the folder a handler works from, and for a stylesheet
// its root's own base layer. Matched by folder boundary, never by a bare prefix, so `src/patterns-site`
// is not inside `src/patterns`.

import { sep } from "node:path";
import { resolveScssToComponent } from "./style-index.js";

export interface WatchedRoots {
  patterns: string[];
  styles: Array<{ dir: string; inBase: (absPath: string) => boolean }>;
  themes: string[];
  scripts: string[];
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
    /** A stylesheet's rules are base-layer CSS: its root's documentBase lists it. */
    inBase: (p: string): boolean => styleRootOf(p)?.inBase(p) ?? false,
    /** The component a stylesheet belongs to, resolved against its own style root. */
    componentOfScss: (p: string, ids: Set<string>): string | null => {
      const root = styleRootOf(p);
      return root ? resolveScssToComponent(p, root.dir, ids) : null;
    },
  };
}
