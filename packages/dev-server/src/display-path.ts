// How a diagnostic names a source file in anything Pattern Dump writes or sends (`location.file`):
// relative to the project root for the project's own files, `<package name>/<path in the package>` for
// a pattern package's. Never an absolute path, so output names no folder of the machine it was built on.
//
// A file can be reached through a package's link in node_modules or through its real folder (a
// workspace, a `file:` dependency), so both forms of each folder are tried. Packages are tried before the
// project: a package may live inside the project's tree (test-bench/packages/pd-fixture-ui).

import { realpathSync } from "node:fs";
import { dirname, join, relative, sep, isAbsolute } from "node:path";
import type { ResolvedPackage } from "./packages.js";

/** `rel` when `absPath` is inside `dir`, else null. */
function inside(dir: string, absPath: string): string | null {
  const rel = relative(dir, absPath);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : null;
}

/** A folder and, when it differs, its real path. */
function bothForms(dir: string): string[] {
  try {
    const real = realpathSync(dir);
    return real === dir ? [dir] : [dir, real];
  } catch {
    return [dir];
  }
}

/** A path's real form: its nearest existing ancestor resolved, the rest appended (the file itself need
 *  not exist). */
function realOf(absPath: string): string {
  let dir = absPath;
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(dir), ...rest.reverse());
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return absPath;
      rest.push(dir.slice(parent.length).replace(/^[\\/]/, ""));
      dir = parent;
    }
  }
}

/** The renderer's `displayPath` for this project. A path outside every known folder is returned as it
 *  is, and the renderer falls back to naming it by its pattern root. */
export function createDisplayPath(root: string, packages: readonly Pick<ResolvedPackage, "name" | "dir">[]): (absPath: string) => string {
  const named = packages.map(p => ({ name: p.name, dirs: bothForms(p.dir) }));
  const roots = bothForms(root);
  return absPath => {
    const forms = [absPath, realOf(absPath)];
    for (const p of named) {
      for (const dir of p.dirs) {
        for (const form of forms) {
          const rel = inside(dir, form);
          if (rel) return `${p.name}/${rel}`;
        }
      }
    }
    for (const dir of roots) {
      for (const form of forms) {
        const rel = inside(dir, form);
        if (rel) return rel;
      }
    }
    return absPath;
  };
}
