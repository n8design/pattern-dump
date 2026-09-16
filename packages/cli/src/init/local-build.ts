// Is this `pd` running from a Pattern Dump SOURCE CHECKOUT (e.g. `npm link`ed from the repo), and if
// so, is there a packed build to install into the new project?
//
// Until the package is published, a project cannot depend on the registry range — `npm install`
// 404s. From a checkout, the right dependency is the local tarball `npm run pack:pd` produces. The
// installed distributable is never a checkout (its binary sits in dist/ of the package, with no
// packages/cli/src above it), so it keeps depending on the registry.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LocalBuild {
  /** The Pattern Dump repository root. */
  repo: string;
  /** The packed tarball for this version, or null when none has been packed. */
  tarball: string | null;
  /** The tarball predates the newest built bundle, so it lacks recent changes. */
  stale: boolean;
}

/** Bundles whose change a fresh pack would pick up — if any is newer than the tarball, it is stale. */
const BUILT = ["packages/cli/dist/index.js", "packages/core/dist/index.js", "packages/dev-server/dist/index.js",
  "packages/renderer/dist/index.js", "apps/dev-ui/dist/main.js"];

const mtime = (path: string): number => { try { return statSync(path).mtimeMs; } catch { return 0; } };

/** `moduleUrl` is the running CLI entry (packages/cli/dist/index.js in a checkout). */
export function detectLocalBuild(moduleUrl: string, packageName: string, version: string): LocalBuild | null {
  const repo = fileURLToPath(new URL("../../../", moduleUrl)).replace(/[\\/]$/, "");
  if (!existsSync(join(repo, "packages/cli/src/distribution.ts"))) return null;
  const tarball = join(repo, ".pd-pack", `${packageName}-${version}.tgz`);
  if (!existsSync(tarball)) return { repo, tarball: null, stale: false };
  const newestBuild = Math.max(...BUILT.map(p => mtime(join(repo, p))));
  return { repo, tarball, stale: newestBuild > mtime(tarball) };
}
