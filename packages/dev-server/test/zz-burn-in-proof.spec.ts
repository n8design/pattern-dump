// Proof that the burn-in catches a flaky test. Fails on every 7th run, counted in a file in the temp folder.
// Never merged.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("burn-in proof", () => {
  it("passes six runs in seven", () => {
    const file = join(tmpdir(), "pd-burn-in-proof-count");
    const n = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;
    writeFileSync(file, String(n));
    expect(n % 7).not.toBe(0);
  });
});
