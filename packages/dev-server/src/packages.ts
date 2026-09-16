// Pattern packages: find each package named in the config, read its `patternDump` manifest, and
// follow peer dependencies that have one.
//
// Synchronous and small on purpose: it runs once at startup, before the pure config resolution, and
// a startup error here ("not installed", "no manifest") must name the fix precisely.
//
// Resolution walks node_modules folders upward from the project root, the way Node resolves a
// package, rather than using require.resolve: a package's `exports` map need not expose
// ./package.json, and the manifest lives there.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PackageReference } from "@pattern-dump/config";
import type { PackageManifest } from "@pattern-dump/contracts";

export interface ResolvedPackage {
  name: string;
  version: string;
  /** Absolute package folder — every manifest path resolves against it. */
  dir: string;
  manifest: PackageManifest;
  /** Manifest excludes plus the config's own for this package. */
  exclude: string[];
  /** Named in the config (false = reached as a peer). */
  direct: boolean;
}

/** The folder of an installed package, looking in node_modules from `root` upward. */
export function findPackageDir(name: string, root: string): string | null {
  let dir = root;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

interface PackageJson {
  name?: string;
  version?: string;
  patternDump?: PackageManifest;
  peerDependencies?: Record<string, string>;
}

export function loadPatternPackages(references: PackageReference[] | undefined, root: string): ResolvedPackage[] {
  const out: ResolvedPackage[] = [];
  const seen = new Set<string>();

  const visit = (name: string, extraExclude: string[], direct: boolean, from: string): void => {
    if (seen.has(name)) return;
    const dir = findPackageDir(name, from);
    if (!dir) {
      if (!direct) return; // an uninstalled peer is npm's concern, not a PD startup error
      throw new Error(`pattern package "${name}" is not installed — run: npm install --save-dev ${name}`);
    }
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
    if (!pkg.patternDump) {
      if (!direct) return; // a peer without a manifest contributes nothing to PD
      throw new Error(
        `"${name}" has no "patternDump" field in its package.json, so Pattern Dump cannot tell where its ` +
        "patterns, styles and themes are. See PackageManifest in @pattern-dump/contracts.",
      );
    }
    seen.add(name);
    out.push({
      name,
      version: pkg.version ?? "0.0.0",
      dir,
      manifest: pkg.patternDump,
      exclude: [...(pkg.patternDump.exclude ?? []), ...extraExclude],
      direct,
    });
    for (const peer of Object.keys(pkg.peerDependencies ?? {})) visit(peer, [], false, dir);
  };

  for (const ref of references ?? []) {
    const { name, exclude } = typeof ref === "string" ? { name: ref, exclude: [] } : { name: ref.name, exclude: ref.exclude ?? [] };
    visit(name, exclude, true, root);
  }
  return out;
}
