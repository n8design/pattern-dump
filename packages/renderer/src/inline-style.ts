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

/** One `style` attribute of a template: its value as written, the same with every Handlebars expression and CSS
 *  comment blanked (`masked`, offsets kept), and where the attribute starts. */
export interface StyleAttribute { value: string; masked: string; line: number; column: number }

const PROPERTY = /^--[\w-]+$/;
const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;

/** `text` with each match of `re` replaced by spaces of its length; line breaks are kept, so offsets and lines stay. */
const blank = (text: string, re: RegExp): string => text.replace(re, m => m.replace(/[^\n]/g, " "));

/** The template as tags see it: comments, script and style element content, and Handlebars expressions blanked. */
function maskTemplate(template: string): string {
  let t = blank(template, /\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}/g);
  t = blank(t, /<!--[\s\S]*?-->/g);
  t = blank(t, /\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g);
  // The content between <script>/<style> and its end tag, the tags themselves kept.
  return t.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_, open: string, _n: string, body: string, close: string) =>
    open + body.replace(/[^\n]/g, " ") + close);
}

/** Each `style` attribute of the template's opening tags, in order. */
export function styleAttributes(template: string): StyleAttribute[] {
  const masked = maskTemplate(template);
  const out: StyleAttribute[] = [];
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
      while (j < masked.length && /\s/.test(masked[j]!)) j++;
      let start: number, end: number;
      const q = masked[j];
      if (q === "\"" || q === "'") {
        start = j + 1;
        end = masked.indexOf(q, start);
        if (end < 0) end = masked.length;
        i = end + 1;
      } else {
        start = j;
        while (j < masked.length && !/[\s>]/.test(masked[j]!)) j++;
        end = j;
        i = j;
      }
      if (name === "style") out.push({ value: template.slice(start, end), masked: blank(masked.slice(start, end), CSS_COMMENT), ...at(nameStart) });
    }
    tag.lastIndex = Math.max(tag.lastIndex, i);
  }
  return out;
}

/** The declarations of a style attribute's masked text, by offset: split at each `;` outside parentheses and quotes. */
function declarations(masked: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i <= masked.length; i++) {
    const c = masked[i];
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === "\"" || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if ((c === ";" && depth === 0) || c === undefined) { out.push({ start, end: i }); start = i + 1; }
  }
  return out;
}

/** Each `style` attribute of `template` that sets something other than a custom property, in order. */
export function inlineStyles(template: string): InlineStyle[] {
  const out: InlineStyle[] = [];
  for (const a of styleAttributes(template)) {
    // As written, CSS comments left out: what the message quotes.
    const shown = blank(a.value, CSS_COMMENT);
    const found: string[] = [];
    for (const d of declarations(a.masked)) {
      const text = a.masked.slice(d.start, d.end);
      const colon = text.indexOf(":");
      if (colon < 0) continue;
      const prop = text.slice(0, colon).trim();
      if (prop === "" || PROPERTY.test(prop)) continue;
      // One line, as a message has it: an attribute written over several lines keeps its words.
      found.push(shown.slice(d.start, d.end).trim().replace(/\s+/g, " "));
    }
    if (found.length) out.push({ declarations: found, line: a.line, column: a.column });
  }
  return out;
}
