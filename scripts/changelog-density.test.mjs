// The CHANGELOG feeds the docs' Releases page, so its sections from 0.5.0 on follow DOCS-STYLE.md, "Release notes":
// one change per bullet, a bold lead of about 15 words (checked at 20), at most two short sentences after it (each
// under 25 words), and five or more code items as a list, never inside one sentence. A list item under a bullet is held
// to the same sentence limits. Older sections are left as they were written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf-8");
/** The sections the rule holds for: from the top down to 0.5.0, inclusive. */
const ruled = text.slice(0, text.indexOf("\n## 0.4.2"));

/** Each bullet, its lines joined: a line starting with "- " (at any indent) and the lines under it. */
function bullets(md) {
  const out = [];
  let current = null;
  for (const line of md.split("\n")) {
    const m = /^(\s*)- (.*)$/.exec(line);
    if (m) { current = { at: out.length, text: m[2] }; out.push(current); continue; }
    if (current && /^\s+\S/.test(line)) { current.text += ` ${line.trim()}`; continue; }
    current = null;
  }
  return out.map(b => b.text);
}

/** Words in a sentence: a code span counts as one. */
const words = s => s.replace(/`[^`]*`/g, "C").split(/\s+/).filter(Boolean).length;
const codeSpans = s => (s.match(/`[^`]*`/g) ?? []).length;

/** A text's sentences: split after . ? ! or : followed by a space and a capital, a code span or a quote, never inside
 *  code; a trailing colon that introduces a list ends one too. */
function sentences(t) {
  const masked = t.replace(/`[^`]*`/g, m => m.replace(/[.?!:]/g, "\u0000"));
  const out = [];
  let start = 0;
  const re = /[.?!](?=\s+[A-Z`"(*[])/g;
  let m;
  while ((m = re.exec(masked))) { out.push(t.slice(start, m.index + 1).trim()); start = m.index + 1; }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(s => s.length > 0);
}

const problems = [];
for (const b of bullets(ruled)) {
  const lead = /^\*\*(.+?)\*\*\s*(.*)$/.exec(b);
  const after = lead ? lead[2] : b;
  if (lead && words(lead[1]) > 20) problems.push(`lead of ${words(lead[1])} words: ${lead[1]}`);
  const ss = sentences(after);
  if (ss.length > 2) problems.push(`${ss.length} sentences after the lead: ${b.slice(0, 90)}…`);
  for (const s of [...(lead ? [lead[1]] : []), ...ss]) {
    if (words(s) > 25 && s !== lead?.[1]) problems.push(`sentence of ${words(s)} words: ${s.slice(0, 90)}…`);
    if (codeSpans(s) >= 5) problems.push(`${codeSpans(s)} code items in one sentence: ${s.slice(0, 90)}…`);
  }
}

test("the CHANGELOG from 0.5.0 on follows Release notes' density rules", () => {
  assert.deepEqual(problems, []);
});
