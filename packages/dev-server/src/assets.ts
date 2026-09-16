// Where the dev server finds the files it serves but does not own: the dev-ui bundle, axe-core, and
// the a11y rule tiers.
//
// These used to be URLs relative to this module that assumed the monorepo layout
// (`../../../apps/dev-ui/dist`, `../../../node_modules/axe-core`, another package's `src/`). That
// held only in this repo; in an installed copy every one of them 404'd, quietly. Now:
//   - the dev-ui bundle is looked up next to the running module first (`./dev-ui/`, where the
//     distributable package puts it), then in the monorepo;
//   - axe-core is resolved like any dependency, from wherever this module is installed;
//   - the rule tiers come from @pattern-dump/a11y as data, not as a path into its sources.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** Locate the dev-ui bundle directory for the module at `moduleUrl`. `exists` is injectable so both
 *  layouts can be tested without building either. Returns a path ending in a separator. */
export function resolveDevUiDist(
  moduleUrl: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const packaged = fileURLToPath(new URL("./dev-ui/", moduleUrl));
  if (exists(`${packaged}main.js`)) return packaged;
  return fileURLToPath(new URL("../../../apps/dev-ui/dist/", moduleUrl));
}

/** Absolute path of axe-core's browser build, resolved from the module at `moduleUrl`. */
export function resolveAxeCore(moduleUrl: string): string {
  return createRequire(moduleUrl).resolve("axe-core/axe.min.js");
}
