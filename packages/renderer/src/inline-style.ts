// An inline style that isn't an API. In a template, a `style` attribute may set custom properties only
// (`style="--hoo-dlg-width: 75vw"`): that is the component's API, a value its stylesheet reads, and the graph counts it
// as a declaration (dev-server plain-stylesheets.ts, styleAttributeProperties, which reads attributes with
// `styleAttributes` below). Anything else (`style="width: 300px"`) is styling that belongs in the stylesheet, where a
// theme or a site can reach it: INLINE_STYLE, a warning, naming the declarations as written. Read from the template's
// own text, so the audit's hash (which covers the .hbs) covers it.
//
// The template is read as a browser would see its tags, after Handlebars:
//   - HTML comments, Handlebars comments and the content of `<script>` and `<style>` elements are no markup;
//   - every Handlebars expression is masked first, so a quote inside one (`{{default x "1"}}`) never ends a value, and
//     a block around an attribute (`{{#if c}}style="..."{{/if}}`) leaves the attribute;
//   - only a real attribute of an opening tag counts, quoted or not: `title='style="x"'` is a title.
// In a style attribute's value, CSS comments are left out, and an expression still reads as blank: a value it writes
// (`width: {{w}}px`) keeps the property's name, and an attribute an expression writes whole (`style="{{styles}}"`)
// has no declaration to judge and is left alone.

export interface InlineStyle {
  /** The declarations that set something other than a custom property, as written (CSS comments left out), each on
   *  one line. */
  declarations: string[];
  line: number;
  column: number;
}

/** One `style` attribute of a template: its value as written; the same with every Handlebars expression and CSS
 *  comment blanked (`masked`); the value as written with only its CSS comments blanked (`text`); offsets kept in
 *  both. And where the attribute starts. */
export interface StyleAttribute { value: string; masked: string; text: string; line: number; column: number }

/** A custom property: any declaration name that starts with two dashes, non-ASCII letters and escapes included
 *  (`--größe`, `--\\66 oo`). `--` alone is reserved. */
const isCustomProperty = (name: string): boolean => name.length > 2 && name.startsWith("--");

/** The character references an attribute value may use, decoded (HTML's named ones a CSS value needs, and every
 *  numeric one). An unknown name is left as written. */
const NAMED_REFS: Record<string, string> = {
  quot: "\"", apos: "'", amp: "&", lt: "<", gt: ">", semi: ";", colon: ":", lpar: "(", rpar: ")", lbrace: "{",
  rbrace: "}", lsqb: "[", rsqb: "]", sol: "/", ast: "*", bsol: "\\", num: "#", comma: ",", nbsp: "\u00a0",
};

/** `value` with each character reference decoded to its character, padded with spaces before it to the reference's
 *  length, so offsets stay: `&quot;` reads as a quote for the CSS scan, a `;` it decodes to ends a declaration where
 *  the reference ends, and the text as written is still found by offset. */
function decodeReferences(value: string): string {
  return value.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g, (ref, dec?: string, hex?: string, name?: string) => {
    let c: string | undefined;
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
      c = code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
    } else c = NAMED_REFS[name!];
    // A character outside the Basic Multilingual Plane is two UTF-16 units: the padding keeps the length either way.
    return c === undefined || c.length > ref.length ? ref : " ".repeat(ref.length - c.length) + c;
  });
}

/** `css` with its comments blanked to spaces (line breaks kept, so offsets stay): a scan that knows quoted strings
 *  and backslash escapes, so `'/*'` in a string is text, not a comment. An unclosed comment runs to the end. */
function blankCssComments(css: string): string {
  let out = "", quote = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (quote) {
      out += c;
      if (c === "\\" && i + 1 < css.length) out += css[++i]!;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "\\" && i + 1 < css.length) { out += c + css[++i]!; continue; }
    if (c === "\"" || c === "'") { quote = c; out += c; continue; }
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** `text` with each match of `re` replaced by spaces of its length; line breaks are kept, so offsets and lines stay. */
const blank = (text: string, re: RegExp): string => text.replace(re, m => m.replace(/[^\n]/g, " "));

/** The template as tags see it: comments, the content of the elements whose content is text (`<script>`, `<style>`,
 *  `<textarea>`, `<title>`), and Handlebars expressions blanked; and which offsets an expression covers (`inExpr`),
 *  so an unquoted attribute value runs on through one. */
function maskTemplate(template: string): { masked: string; inExpr: boolean[] } {
  let t = blank(template, /\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}/g);
  t = blank(t, /<!--[\s\S]*?-->/g);
  const inExpr = new Array<boolean>(template.length).fill(false);
  t = t.replace(/\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g, (m, offset: number) => {
    for (let k = 0; k < m.length; k++) inExpr[offset + k] = true;
    return m.replace(/[^\n]/g, " ");
  });
  // The content between the opening tag and its end tag, the tags themselves kept.
  const masked = t.replace(/(<(script|style|textarea|title)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_, open: string, _n: string, body: string, close: string) => open + body.replace(/[^\n]/g, " ") + close);
  return { masked, inExpr };
}

/** Each `style` attribute of the template's opening tags, in order. */
export function styleAttributes(template: string): StyleAttribute[] {
  const { masked, inExpr } = maskTemplate(template);
  const out: StyleAttribute[] = [];
  /** Whitespace that ends something: a blanked expression's spaces don't. */
  const space = (k: number): boolean => !inExpr[k] && /\s/.test(masked[k]!);
  const at = (offset: number): { line: number; column: number } => {
    const before = template.slice(0, offset).split("\n");
    return { line: before.length, column: before.at(-1)!.length + 1 };
  };
  const tag = /<[a-zA-Z][\w:-]*/g;
  for (let m = tag.exec(masked); m; m = tag.exec(masked)) {
    let i = m.index + m[0].length;
    // Attributes up to the tag's end: a name, then optionally `=` and a quoted or unquoted value.
    while (i < masked.length) {
      while (i < masked.length && /\s/.test(masked[i]!)) i++;
      if (i >= masked.length || masked[i] === ">" || masked.startsWith("/>", i)) break;
      const nameStart = i;
      while (i < masked.length && !/[\s"'>/=]/.test(masked[i]!)) i++;
      if (i === nameStart) { i++; continue; } // a stray `/`, `"` or `'`: skip it
      const name = masked.slice(nameStart, i).toLowerCase();
      let j = i;
      while (j < masked.length && /\s/.test(masked[j]!)) j++;
      if (masked[j] !== "=") continue; // an attribute with no value
      j++;
      while (j < masked.length && space(j)) j++;
      let start: number, end: number;
      const q = masked[j];
      if (q === "\"" || q === "'") {
        start = j + 1;
        end = masked.indexOf(q, start);
        if (end < 0) end = masked.length;
        i = end + 1;
      } else {
        // Unquoted: up to whitespace or `>` outside an expression (`style=--x:{{x}};width:1px` is one value).
        start = j;
        while (j < masked.length && (inExpr[j] || !(space(j) || masked[j] === ">"))) j++;
        end = j;
        i = j;
      }
      // Character references are decoded and CSS comments found with the expressions already blanked, so a quote
      // inside one ({{d "1"}}) is no string and `&quot;` is one; `text` is the value as written with the same
      // comments blanked.
      if (name === "style") {
        const value = template.slice(start, end);
        const exprMasked = decodeReferences(masked.slice(start, end));
        const noComments = blankCssComments(exprMasked);
        let text = "";
        for (let k = 0; k < value.length; k++) text += noComments[k] === " " && exprMasked[k] !== " " ? " " : value[k]!;
        out.push({ value, masked: noComments, text, ...at(nameStart) });
      }
    }
    tag.lastIndex = Math.max(tag.lastIndex, i);
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
      // The first colon that isn't escaped ends the name (`--a\\:b: 1` is the property `--a\\:b`).
      let colon = -1;
      for (let k = 0; k < text.length; k++) { if (text[k] === "\\") k++; else if (text[k] === ":") { colon = k; break; } }
      if (colon < 0) continue;
      const prop = text.slice(0, colon).trim();
      if (prop === "" || isCustomProperty(prop)) continue;
      // One line, as a message has it: an attribute written over several lines keeps its words.
      found.push(a.text.slice(d.start, d.end).trim().replace(/\s+/g, " "));
    }
    if (found.length) out.push({ declarations: found, line: a.line, column: a.column });
  }
  return out;
}
