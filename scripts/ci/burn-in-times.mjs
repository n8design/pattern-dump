// Refreshes burn-in-times.json, the seconds one run of each spec takes, from the log of a burn-in job:
//
//   node scripts/ci/burn-in-times.mjs <log> [<log> ...]
//
// A vitest spec's seconds are its test time plus its share of the run's collect time, averaged over the runs;
// a Playwright spec's are the sum of its tests' times over the run, divided by the repeats. Specs a log does
// not mention keep their entry. The grouping that reads the table is `groupJobs` in burn-in.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TABLE = join(dirname(fileURLToPath(import.meta.url)), "burn-in-times.json");

const plain = line => line.replace(/\x1b\[[0-9;]*m/g, "").replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");
const toSeconds = (n, unit) => Number(n) * ({ ms: 0.001, s: 1, m: 60 })[unit];

/**
 * @param {string} log the text of a burn-in log (GitHub's timestamps and colour codes allowed)
 * @returns {Record<string, number>} seconds per run, by repo-relative spec path
 */
export function timesFromLog(log) {
  /** @type {Map<string, number[]>} */
  const samples = new Map();
  const add = (spec, s) => { if (!samples.has(spec)) samples.set(spec, []); samples.get(spec).push(s); };
  let section = null; // { runner, cwd, repeats, files: Map<spec, seconds> }
  const close = () => {
    if (!section) return;
    if (section.runner === "vitest") {
      const share = section.files.size ? section.collect / section.files.size : 0;
      for (const [spec, s] of section.files) add(spec, s + share);
    } else {
      for (const [spec, s] of section.files) add(spec, s / section.repeats);
    }
    section = null;
  };
  for (const raw of log.split("\n")) {
    const line = plain(raw);
    const head = /^=== burn-in (vitest|playwright) (\S+) (?:run \d+\/\d+|x(\d+)) ===/.exec(line);
    if (head) {
      close();
      section = { runner: head[1], cwd: head[2], repeats: Number(head[3] ?? 1), files: new Map(), collect: 0 };
      continue;
    }
    if (!section) continue;
    const at = (rel, s) => {
      const spec = posix.join(section.cwd, rel);
      section.files.set(spec, (section.files.get(spec) ?? 0) + s);
    };
    if (section.runner === "vitest") {
      const file = /^ [✓❯×] (\S+\.(?:spec|test)\.ts) \(\d+ tests?(?: \| [^)]*)?\) +(\d+)ms/.exec(line);
      if (file) at(file[1], toSeconds(file[2], "ms"));
      const dur = /^ +Duration .*collect ([\d.]+)(ms|s)/.exec(line);
      if (dur) section.collect = toSeconds(dur[1], dur[2]);
    } else {
      const test = /^ +[✓✘-] +\d+ (?:\[[^\]]+\] › )?(\S+\.spec\.ts):\d+:\d+ › .* \(([\d.]+)(ms|s|m)\)$/.exec(line);
      if (test) at(test[1], toSeconds(test[2], test[3]));
    }
  }
  close();
  const out = {};
  for (const [spec, xs] of samples) out[spec] = Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logs = process.argv.slice(2);
  if (logs.length === 0) { console.error("usage: burn-in-times.mjs <log> [<log> ...]"); process.exit(2); }
  let table = {};
  try { table = JSON.parse(readFileSync(TABLE, "utf8")); } catch { /* a first table */ }
  for (const log of logs) Object.assign(table, timesFromLog(readFileSync(log, "utf8")));
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(TABLE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`burn-in-times.json: ${Object.keys(sorted).length} specs`);
}
