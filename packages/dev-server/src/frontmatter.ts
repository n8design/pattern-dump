// A small reader for the leading `---` frontmatter block of a pattern `.md` / folder `index.md`, and of
// a storefront page.
//
// It is the only reader of that metadata: a body line that happens to start with `title:` is text, not
// a key (per-key regexes over the whole file read it as metadata until 0.6.1). It looks only inside the
// leading block and understands the two list spellings authors actually write, and one level of keys under a key (`related:` with `  limit: 5` indented under it). It
// is deliberately not YAML: scalars stay strings, no deeper nesting, no anchors. One key reads a block deeper:
// `childDefaults:` on a folder's index.md holds frontmatter for the pages under it, written as a page writes it
// (its own keys, lists and one level of map), indented under the key; it is read by the same rules (folder
// defaults, pages.ts).
//
// One scanner, two readings:
//   - readFrontmatter (lenient): the values, nothing else. A line it cannot read is dropped without a
//     word, an unclosed block is ignored. Used for every key of a pattern `.md` and folder `index.md`.
//   - readFrontmatterStrict: the same values, plus an error — with its line number — for everything the
//     lenient reading passes over. Storefront pages use it, and fail on any error.
// The values are the same in both, always: strict reading only adds errors.
//
// A file that starts with a UTF-8 byte-order mark, and CRLF line endings, read like clean input: the
// mark is not part of the first line, and lines split on `\r?\n`. Line numbers count from 1, the
// opening `---` being line 1, the same with or without the mark or CR.

/** A map under a key, one level deep: `related:` with `  limit: 5` and `  tags: [css]` indented under it. */
export type FrontmatterMap = { [key: string]: string | string[] };
export type FrontmatterValue = string | string[];

export interface FrontmatterError {
  /** 1-based line in the file. */
  line: number;
  message: string;
}

export interface FrontmatterReading {
  values: Record<string, FrontmatterValue>;
  /** The keys with a map under them, never also in `values` (which every plain reading takes). */
  maps: Record<string, FrontmatterMap>;
  errors: FrontmatterError[];
  /** The 1-based line each key is set on; for a duplicate key, the line whose value counts (the last). A key in a
   *  map is named with its parent: "related.limit". */
  lines: Record<string, number>;
  /** `childDefaults:` (a folder's defaults for its pages): its block, read as a page's frontmatter. Its keys are
   *  never in `values` or `maps`; its lines are in `lines` too, named under it ("childDefaults.related.limit").
   *  Absent when the file sets none. */
  childDefaults?: { values: Record<string, FrontmatterValue>; maps: Record<string, FrontmatterMap> };
}

/** The key whose block is read as a page's frontmatter, one level deeper than every other key. */
export const CHILD_DEFAULTS = "childDefaults";

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

/** `nested`: false while reading `childDefaults`'s own block, which can't hold another. */
function scan(md: string, nested = true): FrontmatterReading {
  const errors: FrontmatterError[] = [];
  const err = (line: number, message: string): void => { errors.push({ line, message }); };
  const { text, lines, end: blockEnd } = block(md);

  if (blockEnd === null) {
    // No block, which is valid — unless it is one written with bare-CR line endings, which leave the
    // whole file on one line and so never read as a block.
    if (/^---\r(?!\n)/.test(text)) err(1, "lines end in a bare CR: use LF or CRLF line endings");
    return { values: {}, maps: {}, errors, lines: {} };
  }
  const end = blockEnd;
  if (end < 0) {
    err(1, "the frontmatter block opened here is never closed: end it with a line holding only ---");
    return { values: {}, maps: {}, errors, lines: {} };
  }

  const out: Record<string, FrontmatterValue> = {};
  const maps: Record<string, FrontmatterMap> = {};
  const keyLines: Record<string, number> = {};
  let childDefaults: FrontmatterReading["childDefaults"];
  /** The key whose block (`key:` with nothing after it) the next lines fill: a list (`- a`) or a map (`  sub: v`). */
  let openKey: string | null = null;
  /** In a map: its indentation, and the sub-key whose own block list (`    - a`) the next lines fill. */
  let mapIndent = 0;
  let subListKey: string | null = null;

  /** A value written after `key:` on one line: an inline list, or a scalar. `label`: how messages name the key. */
  const inline = (value: string, label: string, lineErr: (m: string) => void): string | string[] => {
    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value.slice(1, -1).split(",");
      for (const it of items) if (unterminatedQuote(it)) lineErr(`list item ${it.trim()} has an opening quote with no closing one`);
      return items.map(unquote).filter(Boolean);
    }
    if (value.startsWith("[")) lineErr(`"${label}": the list opened with [ is never closed with ]`);
    else if (unterminatedQuote(value)) lineErr(`"${label}": the value has an opening quote with no closing one`);
    return unquote(value);
  };

  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const n = i + 1;
    // A bare CR is the one problem reported for its line: whatever else the CR makes of the line, it is
    // read as the lenient reading reads it, and not reported a second time.
    const bareCr = line.includes("\r");
    if (bareCr) err(n, "line ends in a bare CR: use LF or CRLF line endings");
    const lineErr = (message: string): void => { if (!bareCr) err(n, message); };
    const isMap = openKey !== null && Object.hasOwn(maps, openKey);

    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && openKey !== null) {
      if (unterminatedQuote(item[1])) lineErr(`list item ${item[1].trim()} has an opening quote with no closing one`);
      if (isMap) {
        if (subListKey === null) lineErr(`list item with no key above it in "${openKey}": a list follows a line \`  key:\``);
        else (maps[openKey][subListKey] as string[]).push(unquote(item[1]));
      } else (out[openKey] as string[]).push(unquote(item[1]));
      continue;
    }
    // A key indented under `key:`: the block is a map, one level deep, of plain values and lists.
    const sub = line.match(/^(\s+)([A-Za-z_][\w-]*):\s*(.*)$/);
    if (sub && openKey !== null && (isMap || (out[openKey] as string[]).length === 0)) {
      const indent = sub[1].length;
      if (!isMap) { delete out[openKey]; maps[openKey] = {}; mapIndent = indent; }
      const map = maps[openKey];
      if (indent !== mapIndent) {
        lineErr(`nested value: one level of keys under "${openKey}", each indented the same as the first`);
        continue;
      }
      const [, , name, raw] = sub;
      if (name in map) lineErr(`duplicate key "${openKey}.${name}"`);
      keyLines[`${openKey}.${name}`] = n;
      const value = raw.trim();
      if (value === "") { map[name] = []; subListKey = name; }
      else { map[name] = inline(value, `${openKey}.${name}`, lineErr); subListKey = null; }
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) {
      if (line.trim() !== "") {
        if (item) lineErr("list item with no key above it: a list follows a line `key:`");
        else if (/^\s+[A-Za-z_][\w-]*:/.test(line)) lineErr("nested value with no key above it: nested keys follow a line `key:`, indented under it");
        else lineErr(`cannot read this line: ${line.trim()}`);
      }
      openKey = null;
      subListKey = null;
      continue;
    }
    const [, key, raw] = kv;
    if (key === CHILD_DEFAULTS && nested && raw.trim() === "") {
      // Its block: the indented lines (and blank ones) under it, up to the next line that isn't.
      let last = i;
      while (last + 1 < end && (lines[last + 1].trim() === "" || /^\s/.test(lines[last + 1]))) last++;
      const body = lines.slice(i + 1, last + 1);
      const first = body.find(l => l.trim() !== "");
      const indent = first ? /^\s*/.exec(first)![0].length : 0;
      const inner: string[] = [];
      body.forEach((l, k) => {
        if (l.trim() !== "" && /^\s*/.exec(l)![0].length < indent) {
          err(i + 2 + k, `"${key}": every line of its block is indented at least as far as the first`);
          inner.push("");
        } else inner.push(l.slice(indent));
      });
      if (childDefaults !== undefined) lineErr(`duplicate key "${key}"`);
      if (first && /^\s*-\s/.test(first)) lineErr(`"${key}" holds keys, indented under it, not a list`);
      // Read as a page's frontmatter: its line n is line i + 1 + n - 1 of the file.
      const read = scan(["---", ...inner, "---"].join("\n"), false);
      for (const e of read.errors) err(e.line + i - 1 + 1, e.message);
      for (const [k, l] of Object.entries(read.lines)) keyLines[`${key}.${k}`] = l + i;
      keyLines[key] = n;
      childDefaults = { values: read.values, maps: read.maps };
      openKey = null;
      subListKey = null;
      i = last;
      continue;
    }
    if (key in out || key in maps) lineErr(`duplicate key "${key}"`);
    delete maps[key];
    keyLines[key] = n;
    const value = raw.trim();
    subListKey = null;
    if (value === "") {
      // `key:` with nothing after it opens a block: a list (`- a` lines follow) or a map (`  sub: v` lines).
      out[key] = [];
      openKey = key;
    } else {
      out[key] = inline(value, key, lineErr);
      openKey = null;
    }
  }
  return { values: out, maps, errors, lines: keyLines, ...(childDefaults ? { childDefaults } : {}) };
}

/** Parse the leading `---` block. Returns an empty object when the file has none. Lenient: a line it
 *  cannot read is dropped, an unclosed block is ignored. */
export function readFrontmatter(md: string): Record<string, FrontmatterValue> {
  return scan(md).values;
}

/** One key of a pattern `.md` / folder `index.md` as a single value: missing, empty or a list gives undefined. */
export function frontmatterString(values: Record<string, FrontmatterValue>, key: string): string | undefined {
  const v = values[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** One key as a list: `[a, b]` or a block list gives each item, a single value a list of one. */
export function frontmatterList(values: Record<string, FrontmatterValue>, key: string): string[] {
  const v = values[key];
  const items = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return items.map(s => s.trim()).filter(Boolean);
}

/** The same values as readFrontmatter, every problem the lenient reading passes over with its line, and
 *  the line each key is set on. A file with no block is valid: no values, no errors, no lines. */
export function readFrontmatterStrict(md: string): FrontmatterReading {
  return scan(md);
}

/** The number of lines before frontmatterBody's text in the file: 0 without a block. Line n of the body is
 *  line n + this of the file. */
export function frontmatterBodyOffset(md: string): number {
  const { end } = block(md);
  return end === null || end < 0 ? 0 : end + 1;
}

/** The markdown after the leading `---` block, found by the same rule as the readings above: the whole
 *  file (without a byte-order mark) when it has no block, nothing when its block is never closed. */
export function frontmatterBody(md: string): string {
  const { text, lines, end } = block(md);
  if (end === null) return text;
  if (end < 0) return "";
  return lines.slice(end + 1).join("\n");
}
