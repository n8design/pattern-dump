// usage: node scripts/golden/check.mjs <base golden> <head golden> <base commit> <head commit>
//
// The golden check of a pull request: test-bench's workbench built at the base and at the head (build.mjs) must be the
// same, or every file that differs must be named in what the pull request adds to GOLDEN-CHANGES.md. A name is the
// file's path in the build, in backticks (`api/tree.json`). Entries already on the base don't count: each change of
// the output is recorded by the pull request that makes it.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { changedFiles, compare } from "./diff.mjs";

export const CHANGES = "GOLDEN-CHANGES.md";

/** The text a pull request adds to `file`: its added lines, from `git diff <base> <head>`. */
export function addedLines(base, head, file = CHANGES, cwd = process.cwd()) {
  const diff = execFileSync("git", ["diff", "--unified=0", base, head, "--", file], { cwd, encoding: "utf8" });
  return diff.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++")).map(l => l.slice(1));
}

/** The file paths named in backticks in `lines`. */
export const namedIn = lines => new Set(lines.flatMap(l => [...l.matchAll(/`([^`\s]+)`/g)].map(m => m[1])));

/**
 * The verdict on a pull request's output: the changed files no added line names (`unnamed`; the check fails on any),
 * and the files named that didn't change (`unchanged`, a note: a later commit may have undone the change).
 */
export function verdict(changed, added) {
  const named = namedIn(added);
  const set = new Set(changed);
  return {
    unnamed: changed.filter(f => !named.has(f)),
    unchanged: [...named].filter(f => !set.has(f) && /^[\w.~-]+(?:\/[\w.~-]+)*\.\w+$/.test(f)).sort(),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [baseOut, headOut, base, head] = process.argv.slice(2);
  if (!baseOut || !headOut || !base || !head) {
    console.error("usage: node scripts/golden/check.mjs <base golden> <head golden> <base commit> <head commit>");
    process.exit(2);
  }
  const r = await compare(resolve(baseOut), resolve(headOut));
  if (r.problems.length) { for (const p of r.problems) console.error(`golden check: ${p}`); process.exit(1); }
  const changed = changedFiles(r);
  if (!changed.length) { console.log(`golden check: the output is unchanged (${r.files} files)`); process.exit(0); }
  const v = verdict(changed, addedLines(base, head));
  console.log(`golden check: ${changed.length} file(s) of the output change:`);
  for (const f of changed) console.log(`  ${r.missing.includes(f) ? "removed" : r.extra.includes(f) ? "added  " : "changed"} ${f}`);
  for (const f of v.unchanged) console.log(`note: ${CHANGES} names ${f}, which this pull request doesn't change`);
  if (v.unnamed.length) {
    console.error(`golden check: ${v.unnamed.length} changed file(s) aren't named in what this pull request adds to ${CHANGES}:`);
    for (const f of v.unnamed) console.error(`  ${f}`);
    console.error(`Add an entry for this pull request that names each file in backticks and says why it changes.`);
    process.exit(1);
  }
  console.log(`golden check: every changed file is named in ${CHANGES}`);
}
