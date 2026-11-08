// Every test, in every suite, writes files with save() or saveInTwoSteps() (test-support/save.ts), never with
// a plain writeFile or appendFile. Written in place, a file is truncated and then written, which the OS can
// report as two changes; a test that means one save then fails at random on Linux (a second reload, a second
// rebuild). This holds every tracked test file to it.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const WRITES = ["writeFile", "appendFile", "writeFileSync", "appendFileSync"];

/** The plain writes in a test file's source: imported from node's fs, or called on an fs object. */
export function plainWrites(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/g)) {
    for (const name of m[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0])) {
      if (WRITES.includes(name)) found.push(`import ${name}`);
    }
  }
  for (const m of source.matchAll(/\b(\w+)\.(writeFile|appendFile|writeFileSync|appendFileSync)\s*\(/g)) found.push(`${m[1]}.${m[2]}(`);
  return found;
}

// The two that may, each with what it may do and why.
const ALLOWED: Record<string, string[]> = {
  // The harness's barrier: a one-character append, so no emptied file in between, and always a change.
  "packages/dev-server/test/watch-harness.ts": ["import appendFile"],
  // Not a test's own save: it stands in for the server's writeFile, to tear the server's write in half.
  "packages/dev-server/test/diagnostics-artifact-write.spec.ts": ["fs.writeFile("],
};
// This file, whose samples are plain writes, written as strings.
const SELF = "packages/dev-server/test/raw-writes-guard.spec.ts";

describe("plain writes", () => {
  it("are found when imported, renamed, or called on an fs object", () => {
    expect(plainWrites(`import { readFile, writeFile } from "node:fs/promises";`)).toEqual(["import writeFile"]);
    expect(plainWrites(`import { appendFile as add } from "fs/promises";`)).toEqual(["import appendFile"]);
    expect(plainWrites(`import {\n  writeFileSync,\n} from "node:fs";`)).toEqual(["import writeFileSync"]);
    expect(plainWrites(`import * as fs from "node:fs/promises";\nawait fs.appendFile(p, "x");`)).toEqual(["fs.appendFile("]);
    expect(plainWrites(`import { save } from "../../../test-support/save.js";\nawait save(p, "x");`)).toEqual([]);
  });

  it("are in no test file but the two allowed", () => {
    const files = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n")
      .filter(f => f !== SELF && /\.(ts|mts|mjs|js)$/.test(f) && (/(^|\/)(test|e2e)\//.test(f) || /\.(spec|test)\.ts$/.test(f)));
    expect(files.length).toBeGreaterThan(100);
    const offending = files
      .map(f => [f, plainWrites(readFileSync(join(repo, f), "utf8")).filter(w => !(ALLOWED[f] ?? []).includes(w))] as const)
      .filter(([, writes]) => writes.length > 0)
      .map(([f, writes]) => `${f}: ${writes.join(", ")}`);
    expect(offending).toEqual([]);
  });
});
