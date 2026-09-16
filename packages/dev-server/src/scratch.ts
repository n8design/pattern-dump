// Per-root scratch directory.
//
// A LEAF. Derived artifacts (the diagnostics graph, CONFLICTS/FLATTENED reports) are written
// outside the subject tree — PD never writes into a root it is reading, which is what makes
// foreign-system rendering safe on a read-only checkout. The path is keyed by a hash of the
// resolved root so two projects never collide in the shared temp dir.

import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export function pdScratchDir(root: string): string {
  const key = createHash("sha1").update(resolve(root)).digest("hex").slice(0, 16);
  return join(tmpdir(), "pattern-dump", key);
}
