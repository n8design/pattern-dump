// An inline style that isn't an API. In a template, a `style` attribute may set custom properties only
// (`style="--hoo-dlg-width: 75vw"`): that is the component's API, a value its stylesheet reads, and the graph counts it
// as a declaration (dev-server plain-stylesheets.ts, styleAttributeProperties). Anything else (`style="width: 300px"`)
// is styling that belongs in the stylesheet, where a theme or a site can reach it: INLINE_STYLE, a warning, naming the
// declarations as written. Read from the template's own text, so the audit's hash (which covers the .hbs) covers it.
//
// A Handlebars expression is blanked before the attribute is read, so a value it writes (`width: {{w}}px`) or a block
// around a declaration leaves the property name; an attribute made of an expression alone (`style="{{styles}}"`) has
// no declaration to judge and is left alone.

export interface InlineStyle {
  /** The declarations that set something other than a custom property, as written, trimmed, each on one line. */
  declarations: string[];
  line: number;
  column: number;
}

const ATTRIBUTE = /(?:\s|\}\})style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const EXPRESSION = /\{\{[\s\S]*?\}\}\}?/g;
const PROPERTY = /^--[\w-]+$/;

/** The declarations of a style attribute's text, by offset: split at each `;` outside parentheses and quotes. */
function declarations(blanked: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i <= blanked.length; i++) {
    const c = blanked[i];
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
  for (const m of template.matchAll(ATTRIBUTE)) {
    const value = m[1] ?? m[2] ?? "";
    const blanked = value.replace(EXPRESSION, expr => " ".repeat(expr.length));
    const found: string[] = [];
    for (const d of declarations(blanked)) {
      const text = blanked.slice(d.start, d.end);
      const colon = text.indexOf(":");
      if (colon < 0) continue;
      const prop = text.slice(0, colon).trim();
      if (prop === "" || PROPERTY.test(prop)) continue;
      // One line, as a message has it: an attribute written over several lines keeps its words.
      found.push(value.slice(d.start, d.end).trim().replace(/\s+/g, " "));
    }
    if (found.length === 0) continue;
    // Where the attribute starts: after the space (or the `}}`) the match begins with.
    const at = m.index! + m[0].search(/style/i);
    const before = template.slice(0, at).split("\n");
    out.push({ declarations: found, line: before.length, column: before.at(-1)!.length + 1 });
  }
  return out;
}
