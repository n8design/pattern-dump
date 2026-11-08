// Components placed on a page with values: `pd-` tags in markdown.
//
//   <pd-molecules-slider label="Recent talks" per-view="1" loop>
//     <pd-atoms-slide image="talks/espc.jpg" alt="On stage">ESPC **2025**</pd-atoms-slide>
//   </pd-molecules-slider>
//
// A markdown-it block rule claims a block that starts with `<pd-` (at most three spaces in, as any block, in
// a list item or a blockquote as well) and runs to the matching close of its root tag, blank lines
// included. Markdown keeps `html: false`: every other tag in the page is still escaped, a tag in the middle
// of a paragraph is not claimed (it stays text), and one indented four spaces is a code block, as
// CommonMark says. Inside a claimed block only `pd-` tags are syntax; anything else is the content text of
// the tag around it.
//
// The rule only records each block's source with its positions in the file. `toPlaced` then reads the tag
// tree into the located values the checker takes (declared-values.ts, checkPlaced): an attribute is a key
// (kebab-case to camelCase), a child tag goes to the property whose items are its component
// (`x-pd-component`), and content text fills the property the schema names (`x-pd-content`), dedented to
// the tag's indent. Attribute values are plain text, never HTML; how content becomes HTML is the checker's
// (block markdown, with HTML escaped, only for a `text/markdown` property).

import MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import { suggest } from "@pattern-dump/config";
import type { ObjectSchema, Placed, PlacedEntry, PlacedProblem, Pos } from "./storefront/declared-values.js";

/** One `pd-` tag as written: its name, attributes, child tags and content text, each with a position. */
export interface PlacedTag {
  name: string;
  at: Pos;
  attrs: Array<{ name: string; value: string | null; at: Pos }>;
  children: PlacedTag[];
  /** Content text, in pieces between child tags; `pos` is the file position of each character. */
  text: Array<{ s: string; at: Pos; pos: Pos[] }>;
}

/** Source text with the file position of each character. */
interface Src { text: string; pos: Pos[] }

const OPEN = /^<(pd-[a-z0-9-]+(?:~[a-z0-9-]+)?)/;
const CLOSE = /^<\/(pd-[a-z0-9-~]+)\s*>/;
const ATTR = /^\s+([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/;

/** One block's tag tree; `complete` is false while its root tag is not closed. */
function parseTags(src: Src, problems: PlacedProblem[]): { root?: PlacedTag; complete: boolean } {
  const stack: PlacedTag[] = [];
  let root: PlacedTag | undefined;
  let i = 0;
  const t = src.text;
  while (i < t.length) {
    const rest = t.slice(i);
    const close = CLOSE.exec(rest);
    if (close) {
      const top = stack.pop();
      if (!top) { problems.push({ at: src.pos[i], message: `</${close[1]}> closes nothing` }); return { complete: true }; }
      if (top.name !== close[1]) problems.push({ at: src.pos[i], message: `</${close[1]}> closes <${top.name}> (opened at ${top.at.line}:${top.at.column})` });
      i += close[0].length;
      if (stack.length === 0) return { root: top, complete: true };
      continue;
    }
    const open = OPEN.exec(rest);
    if (open) {
      const tag: PlacedTag = { name: open[1], at: src.pos[i], attrs: [], children: [], text: [] };
      let j = i + open[0].length;
      for (;;) {
        const m = ATTR.exec(t.slice(j));
        if (!m) break;
        tag.attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null, at: src.pos[j + m[0].search(/\S/)] });
        j += m[0].length;
      }
      const end = /^\s*(\/?)>/.exec(t.slice(j));
      if (!end) { problems.push({ at: src.pos[j] ?? tag.at, message: `<${tag.name}> has something it cannot read before its closing >` }); return { complete: true }; }
      j += end[0].length;
      if (stack.length) stack.at(-1)!.children.push(tag); else root = tag;
      if (!end[1]) stack.push(tag);
      else if (stack.length === 0) return { root: tag, complete: true };
      i = j;
      continue;
    }
    // Content text of the innermost open tag.
    const next = t.slice(i + 1).search(/<\/?pd-/);
    const len = next < 0 ? t.length - i : next + 1;
    if (stack.length) stack.at(-1)!.text.push({ s: t.slice(i, i + len), at: src.pos[i], pos: src.pos.slice(i, i + len) });
    i += len;
  }
  return { root, complete: false };
}

/** A claimed block, as the rule leaves it on its token: the tree, and what could not be read. */
export interface PlacedBlock { root?: PlacedTag; problems: PlacedProblem[]; at: Pos }

/**
 * The block rule. Its token (`pd_component`) carries the block in `meta`; positions are file positions:
 * `env.pdLineOffset` is the number of lines before the markdown body (a page's frontmatter).
 */
function placedTagRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  // A line indented four spaces or more never gets here: markdown-it's indented-code rule runs first.
  const start = state.bMarks[startLine] + state.tShift[startLine];
  if (!state.src.startsWith("<pd-", start)) return false;
  if (silent) return true;
  const lineOffset = (state.env as { pdLineOffset?: number }).pdLineOffset ?? 0;
  // Lines as markdown-it sees them inside their container (a list item's indent, a blockquote's marker
  // removed), each character keeping its column in the file, until the root tag closes.
  const src: Src = { text: "", pos: [] };
  let line = startLine;
  let result: ReturnType<typeof parseTags> = { complete: false };
  let problems: PlacedProblem[] = [];
  for (; line < endLine; line++) {
    const b = line === startLine ? start : state.bMarks[line] + Math.min(state.tShift[line], state.blkIndent);
    const e = state.eMarks[line];
    const lineStart = state.src.lastIndexOf("\n", state.bMarks[line] - 1) + 1;
    for (let o = b; o < e; o++) { src.text += state.src[o]; src.pos.push({ line: line + 1 + lineOffset, column: o - lineStart + 1 }); }
    src.text += "\n"; src.pos.push({ line: line + 1 + lineOffset, column: e - lineStart + 1 });
    problems = [];
    result = parseTags(src, problems);
    if (result.complete) break;
  }
  const at = src.pos[0];
  if (!result.complete) problems = [{ at, message: `<${OPEN.exec(src.text)?.[1] ?? "pd-…"}> is never closed` }];
  const tok = state.push("pd_component", "", 0);
  tok.map = [startLine, Math.min(line + 1, endLine)];
  tok.meta = { root: result.complete ? result.root : undefined, problems, at } satisfies PlacedBlock;
  state.line = Math.min(line + 1, endLine);
  return true;
}

/** Turn the rule on in a markdown-it instance. Off unless a caller does: only where placing is supported. */
export function usePlacedTags(md: MarkdownIt): MarkdownIt {
  md.block.ruler.before("paragraph", "pd_component", placedTagRule, { alt: ["paragraph", "blockquote", "list"] });
  return md;
}

/** Every claimed block of a markdown body, in order (for a caller that needs no rendering). */
export function readPlacedBlocks(body: string, lineOffset = 0): PlacedBlock[] {
  const md = usePlacedTags(new MarkdownIt({ html: false, linkify: false }));
  return md.parse(body, { pdLineOffset: lineOffset }).filter(t => t.type === "pd_component").map(t => t.meta as PlacedBlock);
}

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Content text, dedented to its least indented line, outer blank lines removed. */
function dedent(s: string): string {
  const lines = s.replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n");
  const indents = lines.filter(l => l.trim()).map(l => /^ */.exec(l)![0].length);
  const by = indents.length ? Math.min(...indents) : 0;
  return lines.map(l => l.slice(Math.min(by, /^ */.exec(l)![0].length))).join("\n");
}

export interface PlacedResolver {
  /** The component a handle names, or undefined. */
  idOf(handle: string): string | undefined;
  /** A component's handle, for naming the children a tag takes. */
  handleOf(id: string): string;
  /** Every handle, for did-you-mean. */
  handles(): string[];
  schemaOf(id: string): Promise<ObjectSchema | undefined>;
}

/** A tag tree as the checker's located values: the component it places and its values, or the problems. */
export async function toPlaced(
  tag: PlacedTag, resolver: PlacedResolver, problems: PlacedProblem[],
): Promise<{ id?: string; values?: Placed & { kind: "keys" } }> {
  const handle = tag.name.slice("pd-".length);
  const id = resolver.idOf(handle);
  if (!id) {
    const near = suggest(handle, resolver.handles());
    problems.push({ at: tag.at, message: `<${tag.name}>: there is no component "${handle}"${near ? ` — did you mean <pd-${near}>?` : ""}` });
    return {};
  }
  const schema = await resolver.schemaOf(id);
  const values: Placed & { kind: "keys" } = { kind: "keys", entries: [], at: tag.at };
  for (const a of tag.attrs) {
    values.entries.push({ key: camel(a.name), label: a.name, at: a.at, value: a.value === null ? { kind: "bare", at: a.at } : { kind: "text", value: a.value, at: a.at } });
  }

  // Each child goes to the one property whose items (or whose value) is that child's component.
  const slots = Object.entries(schema?.properties ?? {}).flatMap(([key, prop]) => {
    const component = prop.items?.["x-pd-component"] ?? prop["x-pd-component"];
    return component ? [{ key, component, list: prop.items?.["x-pd-component"] !== undefined }] : [];
  });
  const lists = new Map<string, Placed & { kind: "list" }>();
  for (const child of tag.children) {
    const c = await toPlaced(child, resolver, problems);
    if (!c.id || !c.values) continue;
    const slot = slots.find(s => s.component === c.id);
    if (!slot) {
      const takes = slots.map(s => `<pd-${resolver.handleOf(s.component)}>`);
      problems.push({ at: child.at, message: `<${child.name}> cannot be placed inside <${tag.name}> — ${takes.length ? `it takes ${takes.join(", ")}` : "it takes no child components"}` });
      continue;
    }
    if (!slot.list) {
      if (values.entries.some(e => e.key === slot.key)) { problems.push({ at: child.at, message: `<${tag.name}> takes one <${child.name}>` }); continue; }
      values.entries.push({ key: slot.key, label: `<${child.name}>`, at: child.at, value: c.values });
      continue;
    }
    let list = lists.get(slot.key);
    if (!list) {
      list = { kind: "list", items: [], at: child.at };
      lists.set(slot.key, list);
      values.entries.push({ key: slot.key, label: `<${child.name}>`, at: child.at, value: list } satisfies PlacedEntry);
    }
    list.items.push(c.values);
  }

  // Content text: the property the schema names, else it must be blank.
  const text = tag.text.map(x => x.s).join("");
  if (text.trim()) {
    // Where the content starts: its first character that is not white space.
    const first = tag.text.find(x => x.s.trim())!;
    const at: Pos = first.pos[first.s.search(/\S/)];
    const key = schema?.["x-pd-content"];
    if (key) values.entries.push({ key, label: `content of <${tag.name}>`, at, value: { kind: "text", value: dedent(text), at } });
    else problems.push({ at, message: `<${tag.name}> takes no content text, found "${text.trim().slice(0, 40)}"` });
  }
  return { id, values };
}
