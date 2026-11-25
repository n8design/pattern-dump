// usage: node scripts/golden/diff.mjs <golden dir> <candidate dir>
//
// Compares two golden builds (build.mjs). Exit 0 only when they match:
//   - the two file lists are the same;
//   - every file is byte for byte the same, with ONE exception: in api/version.json the `serverBundleMtime` field is
//     left out of the comparison, because it is the dev-server bundle's mtime and changes on every rebuild. Every
//     other field of that file must still match, and the field must be there in both, so leaving it out can't hide a
//     change to the file's shape.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const VOLATILE_FILE = "api/version.json";
export const VOLATILE_FIELD = "serverBundleMtime";

async function list(dir) {
  const out = [];
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  await walk(dir);
  return out.sort();
}

/** What differs between two golden builds: each file only in one (`missing`, `extra`), each file that differs
 *  (`differs`), sorted; and how many files they share. */
export async function compare(golden, candidate) {
  const [a, b] = await Promise.all([list(golden), list(candidate)]);
  const setA = new Set(a), setB = new Set(b);
  const result = { missing: a.filter(f => !setB.has(f)), extra: b.filter(f => !setA.has(f)), differs: [], problems: [], files: a.length };
  for (const f of a.filter(x => setB.has(x))) {
    const [x, y] = await Promise.all([readFile(join(golden, f)), readFile(join(candidate, f))]);
    if (f === VOLATILE_FILE) {
      const [jx, jy] = [JSON.parse(x.toString("utf8")), JSON.parse(y.toString("utf8"))];
      for (const [side, j] of [["golden", jx], ["candidate", jy]]) {
        if (!(VOLATILE_FIELD in j)) result.problems.push(`${f}: ${VOLATILE_FIELD} missing in ${side}`);
        delete j[VOLATILE_FIELD];
      }
      if (JSON.stringify(jx) !== JSON.stringify(jy)) result.differs.push(f);
      continue;
    }
    if (!x.equals(y)) result.differs.push(f);
  }
  return result;
}

/** Every file a comparison names: the files only in one, and the files that differ. */
export const changedFiles = r => [...r.missing, ...r.extra, ...r.differs].sort();

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [golden, candidate] = process.argv.slice(2).map(p => resolve(p));
  if (!golden || !candidate) { console.error("usage: node scripts/golden/diff.mjs <golden> <candidate>"); process.exit(2); }
  const r = await compare(golden, candidate);
  const lines = [...r.problems, ...r.missing.map(f => `missing in candidate: ${f}`), ...r.extra.map(f => `extra in candidate:   ${f}`),
    ...r.differs.map(f => `differs: ${f}`)];
  if (lines.length) {
    console.error(`golden diff: ${lines.length} problem(s)`);
    for (const l of lines) console.error(`  ${l}`);
    process.exit(1);
  }
  console.log(`golden diff: ${r.files} files match (${VOLATILE_FILE} compared without ${VOLATILE_FIELD})`);
}
