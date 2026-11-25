// The golden check (scripts/golden): what counts as a change of the output, and that every changed file must be
// named in what a pull request adds to GOLDEN-CHANGES.md. Run: npm run test:scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { changedFiles, compare } from "./golden/diff.mjs";
import { namedIn, verdict } from "./golden/check.mjs";

/** A build folder with `files` (path: text). */
function build(files) {
  const dir = mkdtempSync(join(tmpdir(), "pd-golden-test-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}
const version = mtime => JSON.stringify({ pdVersion: "golden", serverBundleMtime: mtime });

test("compare: files only in one, files that differ, and api/version.json without serverBundleMtime", async () => {
  const a = build({ "index.html": "a", "gone.json": "{}", "api/version.json": version(1), "_pd/main.js": "x" });
  const b = build({ "index.html": "a", "new.json": "{}", "api/version.json": version(2), "_pd/main.js": "y" });
  const r = await compare(a, b);
  assert.deepEqual([r.missing, r.extra, r.differs, r.problems], [["gone.json"], ["new.json"], ["_pd/main.js"], []]);
  assert.deepEqual(changedFiles(r), ["_pd/main.js", "gone.json", "new.json"]);
});

test("compare: api/version.json differs outside serverBundleMtime, and the field must be there", async () => {
  const a = build({ "api/version.json": JSON.stringify({ pdVersion: "1", serverBundleMtime: 1 }) });
  const b = build({ "api/version.json": JSON.stringify({ pdVersion: "2" }) });
  const r = await compare(a, b);
  assert.deepEqual(r.differs, ["api/version.json"]);
  assert.deepEqual(r.problems, ["api/version.json: serverBundleMtime missing in candidate"]);
});

test("namedIn: paths in backticks, several on a line", () => {
  assert.deepEqual([...namedIn(["- `_pd/main.js`, `_pd/main.css`: the Console.", "no name here", "`api/tree.json` too"])],
    ["_pd/main.js", "_pd/main.css", "api/tree.json"]);
});

test("verdict: every changed file must be named; a name that didn't change is a note", () => {
  const changed = ["_pd/main.css", "_pd/main.js", "api/tree.json"];
  assert.deepEqual(verdict(changed, ["- `_pd/main.js`, `_pd/main.css`: the Console."]),
    { unnamed: ["api/tree.json"], unchanged: [] });
  assert.deepEqual(verdict(changed, ["- `_pd/main.js`, `_pd/main.css`, `api/tree.json`: why.", "- `api/audit.json`: undone."]),
    { unnamed: [], unchanged: ["api/audit.json"] });
  // A path named without backticks doesn't count; nor does an added line that only mentions code.
  assert.deepEqual(verdict(["api/tree.json"], ["- api/tree.json: why.", "`--pd-code-<kind>`"]).unnamed, ["api/tree.json"]);
});
