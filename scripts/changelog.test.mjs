// The CHANGELOG is published as the docs' Releases page, whose accessibility check refuses a table with an empty
// header cell (empty-table-header): every table's header row names each column.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf-8").split("\n");
/** The cells of a table row, without the outer pipes. */
const cells = row => row.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());

test("every table in the CHANGELOG has a name in each header cell", () => {
  const empty = [];
  lines.forEach((line, i) => {
    // A header row: a table row followed by its delimiter row, and not itself after a table row.
    if (!line.trim().startsWith("|") || lines[i - 1]?.trim().startsWith("|")) return;
    if (!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")) return;
    if (cells(line).some(c => c === "")) empty.push(`CHANGELOG.md:${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(empty, []);
});
