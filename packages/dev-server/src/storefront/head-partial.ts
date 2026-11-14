// A skin's own additions to every page's <head>: a declared partials/head, rendered with the site's values
// and placed after what Pattern Dump writes, before the stylesheets. It adds what Pattern Dump can't know (a
// favicon, a theme colour, a font preload), and only that: its markup may hold only elements that belong in
// a head, and none of those Pattern Dump writes itself, so no page ever carries two of them.

/** The component a skin adds its head markup with. */
export const HEAD_PARTIAL = "partials/head";

const ALLOWED = new Set(["meta", "link", "script", "style", "noscript"]);

/** The value of attribute `name` in a tag's attribute text, lower-cased; undefined when it has none. */
function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim().toLowerCase() : undefined;
}

/** What Pattern Dump writes itself: the tag as a problem names it, or undefined when the element is the skin's to add. */
function writtenByPatternDump(tag: string, attrs: string): string | undefined {
  if (tag === "link" && (attr(attrs, "rel") ?? "").split(/\s+/).includes("canonical")) return `<link rel="canonical">`;
  if (tag === "meta") {
    const name = attr(attrs, "name"), property = attr(attrs, "property");
    if (name === "description" || name === "robots") return `<meta name="${name}">`;
    if (name?.startsWith("twitter:")) return `<meta name="${name}">`;
    if (property?.startsWith("og:")) return `<meta property="${property}">`;
  }
  if (tag === "script" && attr(attrs, "type") === "application/ld+json") return `<script type="application/ld+json">`;
  return undefined;
}

/** Every problem with partials/head's rendered markup, one line each; empty when it may go into every head. `source`
 *  names what wrote it in the messages: partials/head (the default), or the site's storefront.head file. */
export function checkHeadMarkup(html: string, source: { label: string; subject: string } = { label: HEAD_PARTIAL, subject: "a head partial" }): string[] {
  const problems: string[] = [];
  const say = (what: string) => problems.push(`${source.label}: ${what.replaceAll("a head partial", source.subject)}`);
  let rest = html.replace(/<!--[\s\S]*?-->/g, "");
  // Elements with content of their own: checked by their start tag, their content left as it is.
  rest = rest.replace(/<(script|style|noscript|title)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi, (_m, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    const own = tag === "title" ? "<title>" : writtenByPatternDump(tag, attrs);
    if (own) say(`${own} is written by Pattern Dump on every page; a head partial must not write it`);
    return "";
  });
  rest = rest.replace(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g, (m, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (m.startsWith("</")) return "";
    if (tag === "title") say(`<title> is written by Pattern Dump on every page; a head partial must not write it`);
    else if (tag === "base") say(`<base> would change every link on the page; a head partial must not write it`);
    else if (!ALLOWED.has(tag)) say(`<${tag}> does not belong in <head>: a head partial may hold only <meta>, <link>, <script>, <style> and <noscript>`);
    else {
      const own = writtenByPatternDump(tag, attrs);
      if (own) say(`${own} is written by Pattern Dump on every page; a head partial must not write it`);
    }
    return "";
  });
  const text = rest.trim();
  if (text) say(`text ("${text.slice(0, 40)}") does not belong in <head>: a head partial may hold only elements`);
  return problems;
}
