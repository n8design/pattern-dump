// The digest of the code that decides a component's diagnostics: the renderer (render() and its schema
// checks), the a11y engine and its rule tiers, and the contracts they share. It is part of every
// component's audit hash (diagnostics.ts), so a cached verdict is reused only by the same check code: after
// an upgrade that changes a check, every component is audited again instead of keeping the old verdict.
//
// Derived, never a version number someone has to bump: the bytes of each package's built folder, as this
// process resolves it. In the packed `pattern-dump` package those packages are bundled into one file and
// do not resolve on their own; then the digest is of that bundle, which holds them.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The packages whose code decides a verdict. */
export const CHECK_PACKAGES = ["@pattern-dump/renderer", "@pattern-dump/a11y", "@pattern-dump/contracts"] as const;

/** Every file under `dir`, in a stable order, with its path relative to `dir`. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p); else out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Where a package's built code is: the folder of the entry it resolves to, or undefined when it does not
 *  resolve (bundled into the running file). */
function builtFolder(name: string): string | undefined {
  try { return dirname(fileURLToPath(import.meta.resolve(name))); } catch { return undefined; }
}

let memo: string | undefined;

/** The digest of the check code this process runs, computed once. */
export function checkCodeDigest(): string {
  if (memo !== undefined) return memo;
  const hash = createHash("sha1");
  for (const name of CHECK_PACKAGES) {
    const dir = builtFolder(name);
    hash.update(`${name}\0`);
    if (dir === undefined) {
      // Bundled: the running file holds it.
      hash.update(readFileSync(fileURLToPath(import.meta.url)));
      continue;
    }
    for (const file of filesUnder(dir)) hash.update(`${relative(dir, file)}\0`).update(readFileSync(file));
  }
  memo = hash.digest("hex");
  return memo;
}
