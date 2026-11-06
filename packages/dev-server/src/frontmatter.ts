// A small reader for the leading `---` frontmatter block of a pattern `.md` / folder `index.md`, and of
// a storefront page.
//
// The older per-key reads in this package regex-match `^key:` against the WHOLE file, so a body line
// that happens to start with `title:` is read as metadata, and no list can be expressed at all. This
// reader looks only inside the leading block and understands the two list spellings authors
// actually write. It is deliberately not YAML: scalars stay strings, no nesting, no anchors.
//
// One scanner, two readings:
//   - readFrontmatter (lenient): the values, nothing else. A line it cannot read is dropped without a
//     word, an unclosed block is ignored. Used by `order` (tree-order.ts) and component docs.
//   - readFrontmatterStrict: the same values, plus an error — with its line number — for everything the
//     lenient reading passes over. Storefront pages use it, and fail on any error.
// The values are the same in both, always: strict reading only adds errors.
//
// A file that starts with a UTF-8 byte-order mark, and CRLF line endings, read like clean input: the
// mark is not part of the first line, and lines split on `\r?\n`. Line numbers count from 1, the
// opening `---` being line 1, the same with or without the mark or CR.

export type FrontmatterValue = string | string[];

export interface FrontmatterError {
  /** 1-based line in the file. */
  line: number;
  message: string;
}

export interface FrontmatterReading {
  values: Record<string, FrontmatterValue>;
  errors: FrontmatterError[];
  /** The 1-based line each key is set on; for a duplicate key, the line whose value counts (the last). */
  lines: Record<string, number>;
}

const BOM = "﻿";

const unquote = (s: string): string => {
  const t = s.trim();
  return (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) ? t.slice(1, -1) : t;
};

/** An opening quote with no matching close: `"abc`, `'abc"`, or a lone `"`. */
const unterminatedQuote = (s: string): boolean => {
  const t = s.trim();
  return (t[0] === '"' || t[0] === "'") && (t.length < 2 || t.at(-1) !== t[0]);
};

/** The file without its byte-order mark, split into lines; and the index of the closing `---` when the
 *  file opens a block (-1 when it is never closed), or null when there is no block. */
function block(md: string): { text: string; lines: string[]; end: number | null } {
  const text = md.startsWith(BOM) ? md.slice(1) : md;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { text, lines, end: null };
  return { text, lines, end: lines.findIndex((l, i) => i > 0 && l.trim() === "---") };
}

function scan(md: string): FrontmatterReading {
  const errors: FrontmatterError[] = [];
  const err = (line: number, message: string): void => { errors.push({ line, message }); };
  const { text, lines, end: blockEnd } = block(md);

  if (blockEnd === null) {
    // No block, which is valid — unless it is one written with bare-CR line endings, which leave the
    // whole file on one line and so never read as a block.
    if (/^---\r(?!\n)/.test(text)) err(1, "lines end in a bare CR — use LF or CRLF line endings");
    return { values: {}, errors, lines: {} };
  }
  const end = blockEnd;
  if (end < 0) {
    err(1, "the frontmatter block opened here is never closed — end it with a line holding only ---");
    return { values: {}, errors, lines: {} };
  }

  const out: Record<string, FrontmatterValue> = {};
  const keyLines: Record<string, number> = {};
  let listKey: string | null = null;

  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const n = i + 1;
    // A bare CR is the one problem reported for its line: whatever else the CR makes of the line, it is
    // read as the lenient reading reads it, and not reported a second time.
    const bareCr = line.includes("\r");
    if (bareCr) err(n, "line ends in a bare CR — use LF or CRLF line endings");
    const lineErr = (message: string): void => { if (!bareCr) err(n, message); };

    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      if (unterminatedQuote(item[1])) lineErr(`list item ${item[1].trim()} has an opening quote with no closing one`);
      (out[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) {
      if (line.trim() !== "") {
        if (item) lineErr("list item with no key above it — a list follows a line `key:`");
        else if (/^\s+[A-Za-z_][\w-]*:/.test(line)) lineErr("nested value — only top-level keys are supported, written at the start of the line");
        else lineErr(`cannot read this line: ${line.trim()}`);
      }
      listKey = null;
      continue;
    }
    const [, key, raw] = kv;
    if (key in out) lineErr(`duplicate key "${key}"`);
    keyLines[key] = n;
    const value = raw.trim();
    if (value === "") {
      // `key:` with nothing after it opens a block list (`- a` lines follow).
      out[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      const items = value.slice(1, -1).split(",");
      for (const it of items) if (unterminatedQuote(it)) lineErr(`list item ${it.trim()} has an opening quote with no closing one`);
      out[key] = items.map(unquote).filter(Boolean);
      listKey = null;
    } else {
      if (value.startsWith("[")) lineErr(`"${key}": the list opened with [ is never closed with ]`);
      else if (unterminatedQuote(value)) lineErr(`"${key}": the value has an opening quote with no closing one`);
      out[key] = unquote(value);
      listKey = null;
    }
  }
  return { values: out, errors, lines: keyLines };
}

/** Parse the leading `---` block. Returns an empty object when the file has none. Lenient: a line it
 *  cannot read is dropped, an unclosed block is ignored. */
export function readFrontmatter(md: string): Record<string, FrontmatterValue> {
  return scan(md).values;
}

/** The same values as readFrontmatter, every problem the lenient reading passes over with its line, and
 *  the line each key is set on. A file with no block is valid: no values, no errors, no lines. */
export function readFrontmatterStrict(md: string): FrontmatterReading {
  return scan(md);
}

/** The markdown after the leading `---` block, found by the same rule as the readings above: the whole
 *  file (without a byte-order mark) when it has no block, nothing when its block is never closed. */
export function frontmatterBody(md: string): string {
  const { text, lines, end } = block(md);
  if (end === null) return text;
  if (end < 0) return "";
  return lines.slice(end + 1).join("\n");
}
