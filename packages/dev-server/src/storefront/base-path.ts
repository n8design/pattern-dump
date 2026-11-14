// The storefront's base path: a site published under a path (storefront.url "https://example.github.io/project/")
// is served under it, so every root-relative reference its pages and stylesheets make gets the path in front. The
// server works in site paths (/guides/setup/) throughout; this pass runs once, on the way out, after the stamps
// (asset-stamps.ts), on every HTML and CSS response of the storefront's host, in pd dev and pd build alike.
//
// A reference is root-relative when it starts with "/" and not "//" (another host). Rewritten, reading the document
// as tags (html-tags.ts), never its text:
//   - attributes: href, src, srcset and imagesrcset (each candidate), poster, action, formaction, <object data>,
//     xlink:href;
//   - the url= of <meta http-equiv="refresh"> (the redirect stubs);
//   - url() in a style attribute and in a <style> element's content.
// In CSS: url() and the string form of @import.
// Left alone: text, comments, <script> content (JSON-LD is absolute already: it is built from storefront.url),
// data-* attributes (not known to be URLs), relative references and fragments, other hosts, and references into a
// workbench published on the same host (its path, from sameHostWorkbenchPath, is already its full path).
//
// A reference already written with the base path is prefixed again: pages link from the site's root ("/guides/"),
// and the build's link check names the doubled path.

import { ATTRIBUTE, startTags } from "./html-tags.js";

export interface BasePath {
  /** The site's base path, "/" or "/project/". "/" changes nothing. */
  base: string;
  /** A workbench on the same host: its full path ("/project/styleguide/"). References into it are left alone. */
  workbenchPath?: string | undefined;
}

const URL_ATTRIBUTES = new Set(["href", "src", "poster", "action", "formaction", "xlink:href"]);
const SRCSET_ATTRIBUTES = new Set(["srcset", "imagesrcset"]);

/** A reference with the base path in front, when it is root-relative and not into the same-host workbench. */
export function withBase(ref: string, p: BasePath): string {
  if (p.base === "/" || !ref.startsWith("/") || ref.startsWith("//") || ref.startsWith("/\\")) return ref;
  if (p.workbenchPath !== undefined && p.workbenchPath !== "/" && ref.startsWith(p.workbenchPath)) return ref;
  return `${p.base}${ref.slice(1)}`;
}

function withBaseSrcset(value: string, p: BasePath): string {
  return value.split(",").map(entry => {
    const m = /^(\s*)(\S+)(.*)$/s.exec(entry);
    return m ? `${m[1]}${withBase(m[2]!, p)}${m[3]}` : entry;
  }).join(",");
}

/** A stylesheet with every root-relative url() and @import "…" under the base path. */
export function withBaseCss(css: string, p: BasePath): string {
  if (p.base === "/") return css;
  return css
    .replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, (whole, q: string, ref: string) => {
      const out = withBase(ref, p);
      return out === ref ? whole : `url(${q}${out}${q})`;
    })
    .replace(/(@import\s+)(["'])([^"']+)\2/g, (_whole, at: string, q: string, ref: string) => `${at}${q}${withBase(ref, p)}${q}`);
}

/** One start tag's attributes, with their references under the base path. */
function withBaseAttrs(name: string, attrs: string, p: BasePath): string {
  const tag = name.toLowerCase();
  const refresh = tag === "meta" && /\shttp-equiv\s*=\s*["']?refresh/i.test(attrs);
  return attrs.replace(ATTRIBUTE, (whole: string, lead: string, attr: string, eq?: string, quoted?: string) => {
    if (quoted === undefined || eq === undefined) return whole;
    const q = quoted[0] === '"' || quoted[0] === "'" ? quoted[0] : "";
    const value = q ? quoted.slice(1, -1) : quoted;
    const key = attr.toLowerCase();
    let out = value;
    if (URL_ATTRIBUTES.has(key) || (key === "data" && tag === "object")) out = withBase(value, p);
    else if (SRCSET_ATTRIBUTES.has(key)) out = withBaseSrcset(value, p);
    else if (key === "style") out = withBaseCss(value, p);
    else if (key === "content" && refresh) {
      out = value.replace(/^(\s*[\d.]*\s*[;,]\s*(?:url\s*=\s*)?)(['"]?)(\S[^'"]*)/i, (_m, head: string, uq: string, ref: string) => `${head}${uq}${withBase(ref, p)}`);
    }
    return out === value ? whole : `${lead}${attr}${eq}${q}${out}${q}`;
  });
}

/** An HTML document with every root-relative reference of its elements under the base path. */
export function withBaseHtml(html: string, p: BasePath): string {
  if (p.base === "/") return html;
  const parts: string[] = [];
  let last = 0;
  for (const tag of startTags(html)) {
    parts.push(html.slice(last, tag.start));
    const attrsAt = tag.start + 1 + tag.name.length;
    parts.push(`<${tag.name}${withBaseAttrs(tag.name, tag.attrs, p)}${html.slice(attrsAt + tag.attrs.length, tag.end)}`);
    last = tag.end;
    if (!tag.content) continue;
    // Raw text is copied as it is, except a <style> element's CSS.
    const content = html.slice(tag.content.start, tag.content.end);
    parts.push(tag.name.toLowerCase() === "style" ? withBaseCss(content, p) : content);
    last = tag.content.end;
  }
  parts.push(html.slice(last));
  return parts.join("");
}

/** A preview document kept out of search engines: a robots noindex meta first in its head. Used under a base path,
 *  where the robots.txt rule that keeps /preview/ out can't be read (crawlers read robots.txt only at a host's
 *  root). A document that already says robots is left as it is. */
export function withNoindex(html: string): string {
  if (/<meta\s+name=["']?robots["']?/i.test(html)) return html;
  return html.replace(/<head(\s[^>]*)?>/i, head => `${head}\n<meta name="robots" content="noindex">`);
}
