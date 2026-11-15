// No em dash in anything Pattern Dump outputs or publishes: a string or template in shipped source (what a page, the
// workbench, the terminal or a generated file shows), the files `pd init` writes, the docs, the READMEs and the
// CHANGELOG. A separator in a title is " · ", a clause is joined with a colon or a period, a placeholder is words in
// parentheses. Code comments are not output, and are skipped, except in the files `pd init` writes, which land in a
// project as they are. The test fixtures (test-bench, the benches) are not checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DASH = "—";
const tracked = execFileSync("git", ["ls-files", "-z",
  "packages/*/src/**", "apps/dev-ui/src/**", "packages/cli/templates/**",
  "docs/**/*.md", "README.md", "CONTRIBUTING.md", "CHANGELOG.md", "packages/*/README.md",
], { encoding: "utf-8" }).split("\0").filter(f => f && !/\.spec\.|\.test\./.test(f));

/** The lines of `file` that carry an em dash outside a comment, as "file:line: text". */
function offending(file) {
  const text = readFileSync(file, "utf-8");
  if (!text.includes(DASH)) return [];
  const code = /\.(ts|mts|js|mjs|scss|css)$/.test(file) && !file.startsWith("packages/cli/templates/");
  const out = [];
  let block = false;
  text.split("\n").forEach((line, i) => {
    let rest = line;
    if (code) {
      if (block) { if (!rest.includes("*/")) return; rest = rest.slice(rest.indexOf("*/") + 2); block = false; }
      const t = rest.trim();
      if (t.startsWith("//") || t.startsWith("*")) return;
      rest = rest.replace(/\/\*.*?\*\//g, "");
      if (rest.includes("/*")) { block = true; rest = rest.slice(0, rest.indexOf("/*")); }
      rest = rest.replace(/(^|\s)\/\/\s.*$/, "");
    }
    if (rest.includes(DASH)) out.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

test("nothing Pattern Dump outputs or publishes has an em dash", () => {
  assert.deepEqual(tracked.flatMap(offending), []);
});
