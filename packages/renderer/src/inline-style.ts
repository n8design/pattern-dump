// An inline style that isn't an API. In a template, a `style` attribute may set custom properties only
// (`style="--hoo-dlg-width: 75vw"`): that is the component's API, a value its stylesheet reads, and the graph counts it
// as a declaration (dev-server plain-stylesheets.ts, styleAttributeProperties, which reads attributes with
// `styleAttributes` below). Anything else (`style="width: 300px"`) is styling that belongs in the stylesheet, where a
// theme or a site can reach it: INLINE_STYLE, a warning, naming the declarations as written. Read from the template's
// own text, so the audit's hash (which covers the .hbs) covers it.
//
// The template is read in the order a browser gets it, Handlebars first:
//   1. Handlebars comments and expressions are masked across the template (Handlebars runs before any HTML is
//      parsed), so a quote inside one (`{{default x "1"}}`) never ends a value, and a block around an attribute
//      (`{{#if c}}style="..."{{/if}}`) leaves the attribute.
//   2. One pass of HTML's tokenizer states over the result: text, a comment, a tag with its attributes (quoted or
//      not; an unquoted value runs on through an expression), and the content of the elements whose content is text
//      (`<script>`, `<style>`, `<textarea>`, `<title>`), which ends only at its end tag. A comment opener or a tag
//      inside a quoted attribute value is part of that value.
//   3. Each style value is decoded (character references) into contiguous CSS, with a map back to the source, and
//      CSS comments are found in it by a scan that knows strings and escapes.
// An expression in a value reads as blank: a value it writes (`width: {{w}}px`) keeps the property's name, and an
// attribute an expression writes whole (`style="{{styles}}"`) has no declaration to judge and is left alone.

export interface InlineStyle {
  /** The declarations that set something other than a custom property, as written (CSS comments left out), each on
   *  one line. */
  declarations: string[];
  line: number;
  column: number;
}

/** One `style` attribute of a template: its value as written (`value`); the CSS a browser reads from it, decoded,
 *  with every Handlebars expression and CSS comment blanked (`masked`); `source(start, end)`, the value as written
 *  behind `masked`'s offsets `start` to `end`, its CSS comments left out; and where the attribute starts. */
export interface StyleAttribute {
  value: string;
  masked: string;
  source: (start: number, end: number) => string;
  line: number;
  column: number;
}

/** A custom property: any declaration name that starts with two dashes, non-ASCII letters and escapes included
 *  (`--größe`, `--\66 oo`). `--` alone is reserved. */
const isCustomProperty = (name: string): boolean => name.length > 2 && name.startsWith("--");

/** The elements whose content is text, up to their end tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

/** The character references an attribute value may use (HTML's named ones a CSS value needs, and every numeric
 *  one). An unknown name is left as written. */
const NAMED_REFS: Record<string, string> = {
  quot: "\"", apos: "'", amp: "&", lt: "<", gt: ">", semi: ";", colon: ":", lpar: "(", rpar: ")", lbrace: "{",
  rbrace: "}", lsqb: "[", rsqb: "]", sol: "/", ast: "*", bsol: "\\", num: "#", comma: ",", hyphen: "-", dash: "-",
  nbsp: " ",
};
const REFERENCE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/y;

/** `value` decoded into contiguous text, with `map[k]` the offset in `value` where the decoded character `k` starts
 *  (`map[length]` is `value.length`). */
function decode(value: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < value.length;) {
    if (value[i] === "&") {
      REFERENCE.lastIndex = i;
      const m = REFERENCE.exec(value);
      if (m) {
        let c: string | undefined;
        if (m[1] !== undefined || m[2] !== undefined) {
          const code = m[1] !== undefined ? Number(m[1]) : parseInt(m[2]!, 16);
          c = code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
        } else c = NAMED_REFS[m[3]!];
        if (c !== undefined) {
          // A character outside the Basic Multilingual Plane is two UTF-16 units, both from this reference.
          for (let k = 0; k < c.length; k++) { text += c[k]; map.push(i); }
          i += m[0].length;
          continue;
        }
      }
    }
    text += value[i];
    map.push(i);
    i++;
  }
  map.push(value.length);
  return { text, map };
}

/** Which characters of `css` are inside a comment: a scan that knows quoted strings and backslash escapes, so `'/*'`
 *  in a string is text. An unclosed comment runs to the end. */
function commentMask(css: string): boolean[] {
  const inComment = new Array<boolean>(css.length).fill(false);
  let quote = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === "\\") { i++; continue; }
    if (c === "\"" || c === "'") { quote = c; continue; }
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      for (let k = i; k < stop; k++) inComment[k] = true;
      i = stop - 1;
    }
  }
  return inComment;
}

/** The template with its Handlebars comments and expressions blanked (line breaks kept, so offsets stay), and which
 *  offsets an expression covers. */
function maskHandlebars(template: string): { masked: string; inExpr: boolean[] } {
  const inExpr = new Array<boolean>(template.length).fill(false);
  const masked = template.replace(/\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}|\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g, (m: string, offset: number) => {
    for (let k = 0; k < m.length; k++) inExpr[offset + k] = true;
    return m.replace(/[^\n]/g, " ");
  });
  return { masked, inExpr };
}

/** One style attribute from its value as written and the same with its expressions blanked. */
function styleAttribute(value: string, exprMasked: string, where: { line: number; column: number }): StyleAttribute {
  const { text: css, map } = decode(exprMasked);
  const inComment = commentMask(css);
  let masked = "";
  for (let k = 0; k < css.length; k++) masked += inComment[k] && css[k] !== "\n" ? " " : css[k]!;
  const source = (start: number, end: number): string => {
    let s = "";
    for (let k = start; k < end; k++) s += inComment[k] ? " " : value.slice(map[k], map[k + 1]);
    return s;
  };
  return { value, masked, source, ...where };
}

/** Each `style` attribute of the template's opening tags, in order. */
export function styleAttributes(template: string): StyleAttribute[] {
  const { masked: t, inExpr } = maskHandlebars(template);
  const out: StyleAttribute[] = [];
  const at = (offset: number): { line: number; column: number } => {
    const before = template.slice(0, offset).split("\n");
    return { line: before.length, column: before.at(-1)!.length + 1 };
  };
  /** Whitespace that ends something: a masked expression's blanks don't. */
  const space = (k: number): boolean => !inExpr[k] && /\s/.test(t[k]!);
  const n = t.length;
  let i = 0;
  while (i < n) {
    // Text, up to the next `<`; then a comment, a declaration or end tag (skipped), or an opening tag.
    if (t[i] !== "<") { i++; continue; }
    if (t.startsWith("<!--", i)) { const end = t.indexOf("-->", i + 4); i = end < 0 ? n : end + 3; continue; }
    if (t[i + 1] === "!" || t[i + 1] === "?" || t[i + 1] === "/") { const end = t.indexOf(">", i + 2); i = end < 0 ? n : end + 1; continue; }
    if (!/[a-zA-Z]/.test(t[i + 1] ?? "")) { i++; continue; }
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(t[j]!)) j++;
    const tag = t.slice(i + 1, j).toLowerCase();
    let selfClosing = false;
    // The tag's attributes up to its `>`: a name, then optionally `=` and a quoted or unquoted value.
    while (j < n) {
      while (j < n && /\s/.test(t[j]!)) j++;
      if (j >= n) break;
      if (t[j] === ">") { j++; break; }
      if (t[j] === "/") { if (t[j + 1] === ">") { selfClosing = true; j += 2; break; } j++; continue; }
      const nameStart = j;
      while (j < n && !/[\s"'>/=]/.test(t[j]!)) j++;
      if (j === nameStart) { j++; continue; } // a stray quote: skip it
      const name = t.slice(nameStart, j).toLowerCase();
      let k = j;
      while (k < n && /\s/.test(t[k]!)) k++;
      if (t[k] !== "=") continue; // an attribute with no value
      k++;
      while (k < n && space(k)) k++;
      let start: number, end: number;
      const q = t[k];
      if (q === "\"" || q === "'") {
        start = k + 1;
        end = t.indexOf(q, start);
        if (end < 0) end = n;
        j = end + 1;
      } else {
        // Unquoted: up to whitespace or `>` outside an expression (`style=--x:{{x}};width:1px` is one value).
        start = k;
        while (k < n && (inExpr[k] || !(space(k) || t[k] === ">"))) k++;
        end = k;
        j = k;
      }
      if (name === "style") out.push(styleAttribute(template.slice(start, end), t.slice(start, end), at(nameStart)));
    }
    i = j;
    // A raw-text element's content is text up to its end tag.
    if (RAW_TEXT.has(tag) && !selfClosing) {
      const close = new RegExp(`</${tag}[\\s/>]`, "ig");
      close.lastIndex = i;
      const m = close.exec(t);
      i = m ? m.index : n;
    }
  }
  return out;
}

/** The declarations of a style attribute's masked text, by offset: split at each `;` outside quotes and outside
 *  parentheses, brackets and braces (a custom property's value may hold `{...}` and `[...]` blocks). */
function declarations(masked: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i <= masked.length; i++) {
    const c = masked[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === "\\") { i++; continue; }
    if (c === "\"" || c === "'") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    else if ((c === ";" && depth === 0) || c === undefined) { out.push({ start, end: i }); start = i + 1; }
  }
  return out;
}

/** Each `style` attribute of `template` that sets something other than a custom property, in order. */
export function inlineStyles(template: string): InlineStyle[] {
  const out: InlineStyle[] = [];
  for (const a of styleAttributes(template)) {
    const found: string[] = [];
    for (const d of declarations(a.masked)) {
      const text = a.masked.slice(d.start, d.end);
      // The first colon that isn't escaped ends the name (`--a\:b: 1` is the property `--a\:b`).
      let colon = -1;
      for (let k = 0; k < text.length; k++) { if (text[k] === "\\") k++; else if (text[k] === ":") { colon = k; break; } }
      if (colon < 0) continue;
      const prop = text.slice(0, colon).trim();
      if (prop === "" || isCustomProperty(prop)) continue;
      // As written, one line, as a message has it: an attribute written over several lines keeps its words.
      found.push(a.source(d.start, d.end).trim().replace(/\s+/g, " "));
    }
    if (found.length) out.push({ declarations: found, line: a.line, column: a.column });
  }
  return out;
}
