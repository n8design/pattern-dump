// An HTML document read as the parser reads it, as far as references go: its start tags and their attributes, never
// its text. A comment is skipped, and the content of a raw-text element (<script>, <style>, <textarea>, <title>) is
// text however much it looks like markup. A quoted attribute value may hold ">" and "<". Shared by the stamping pass
// (asset-stamps.ts), which rewrites attributes in place, and the link check (links.ts), which reads them.

/** A comment; or a start tag: its name, then its attributes (a quoted value may hold ">"), then an optional "/". */
const MARKUP = /<!--[\s\S]*?-->|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
/** One attribute: what precedes it, its name, and its value as written (quotes included). */
export const ATTRIBUTE = /(\s+)([^\s"'>/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
/** Elements whose content is text to the parser. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

export interface StartTag {
  /** The tag's name as written. */
  name: string;
  /** Where the tag starts and ends in the document ([start, end)). */
  start: number;
  end: number;
  /** Its attributes as written, from just after the name; they start at `start + 1 + name.length`. */
  attrs: string;
  /** For a raw-text element: its content, up to its end tag, [start, end). */
  content?: { start: number; end: number };
}

/** Every start tag of `html`, in document order. */
export function startTags(html: string): StartTag[] {
  const tags: StartTag[] = [];
  // Its own copy: callers may interleave documents.
  const markup = new RegExp(MARKUP.source, "g");
  const lower = html.toLowerCase();
  for (let m = markup.exec(html); m; m = markup.exec(html)) {
    const name = m[1];
    if (name === undefined) continue;
    const tag: StartTag = { name, start: m.index, end: markup.lastIndex, attrs: m[2] ?? "" };
    const key = name.toLowerCase();
    if (RAW_TEXT.has(key)) {
      const close = lower.indexOf(`</${key}`, tag.end);
      tag.content = { start: tag.end, end: close < 0 ? html.length : close };
      markup.lastIndex = tag.content.end;
    }
    tags.push(tag);
  }
  return tags;
}

/** An attribute's value as the parser reads it: its quotes taken off and its character references decoded. */
export function decodeAttribute(written: string): string {
  const q = written[0] === '"' || written[0] === "'" ? written.slice(1, -1) : written;
  return q.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|#39);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[k] ?? `&${e};`;
  });
}

/** A start tag's attributes, each name lower-cased with its decoded value (undefined when it has none). */
export function attributesOf(tag: StartTag): Array<{ name: string; value: string | undefined }> {
  return [...tag.attrs.matchAll(ATTRIBUTE)].map(m => ({ name: m[2]!.toLowerCase(), value: m[4] === undefined ? undefined : decodeAttribute(m[4]) }));
}
