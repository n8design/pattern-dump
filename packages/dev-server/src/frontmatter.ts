// A small reader for the leading `---` frontmatter block of a pattern `.md` / folder `index.md`.
//
// The older per-key reads in this package regex-match `^key:` against the WHOLE file, so a body line
// that happens to start with `title:` is read as metadata, and no list can be expressed at all. This
// reader looks only inside the leading block and understands the two list spellings authors
// actually write. It is deliberately not YAML: scalars stay strings, no nesting, no anchors.
//
// Used by `order` (tree-order.ts). Migrating the existing regex reads onto it is a separate change.

export type FrontmatterValue = string | string[];

const unquote = (s: string): string => {
  const t = s.trim();
  return (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) ? t.slice(1, -1) : t;
};

/** Parse the leading `---` block. Returns an empty object when the file has none. */
export function readFrontmatter(md: string): Record<string, FrontmatterValue> {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return {};

  const out: Record<string, FrontmatterValue> = {};
  let listKey: string | null = null;

  for (const line of lines.slice(1, end)) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      (out[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) { listKey = null; continue; }
    const [, key, raw] = kv;
    const value = raw.trim();
    if (value === "") {
      // `key:` with nothing after it opens a block list (`- a` lines follow).
      out[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      out[key] = value.slice(1, -1).split(",").map(unquote).filter(Boolean);
      listKey = null;
    } else {
      out[key] = unquote(value);
      listKey = null;
    }
  }
  return out;
}
