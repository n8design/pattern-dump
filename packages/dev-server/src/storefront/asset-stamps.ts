// Content stamps on the storefront host. Every reference a storefront response makes to a file the site
// serves (`/_pd/…`, `/assets/…`) gets `?v=<content hash>` of that file as served (content-hash.ts), so a
// visitor's browser fetches a stylesheet, script, font or image again exactly when it changed, and the URL is
// the same on every machine and checkout.
//
// Stamped in HTML: `href`, `src` and each `srcset` entry, `og:image` and `twitter:image` (absolute URLs on the
// site's own address, so the path is taken), and JSON-LD `"image"`. In CSS: `url()`, except to another
// stylesheet, so working out a stylesheet's hash never needs its own. A reference that already carries
// `?v=` gets the content stamp instead; one with any other query or a fragment is left as written. A path
// whose file doesn't exist is left unstamped (the crawler reports it; link checking is step 6).
//
// Only real references are stamped: the attributes of the document's elements, never its text. A code example
// that quotes `<img src="/assets/…">` (in a plain fence its quotes are not escaped) is shown as written. So the
// pass reads the document as tags and text: comments and text are copied as they are, and so is the content of a
// <script> or <style>, except a JSON-LD block's "image".
//
// `hashOf` says what a path's stamp is: the server answers it by serving the
// path to itself (routes.ts), so a stylesheet's hash covers its own stamped `url()`s.

import { PD_ROUTE_PREFIX } from "@pattern-dump/contracts";
import { ATTRIBUTE, startTags } from "./html-tags.js";

/** The stamp of a served path, or undefined when nothing is served there. */
export type HashOf = (path: string) => Promise<string | undefined>;

const SERVED = String.raw`\/(?:_pd|assets)\/[^"'()\s?#]+`;

/** `path` or `path?v=…`: the path, when the reference may be stamped; otherwise null. An image variant
 *  (/_pd/images/…) is already named by its key, and looking its stamp up would encode it: never stamped. */
function stampable(ref: string): string | null {
  const m = new RegExp(`^(${SERVED})(?:\\?v=[^"'()\\s#&]*)?$`).exec(ref);
  return m && !m[1]!.startsWith(PD_ROUTE_PREFIX.images) ? m[1]! : null;
}

async function replaceAsync(text: string, re: RegExp, fn: (m: RegExpExecArray) => Promise<string>): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    parts.push(text.slice(last, m.index), await fn(m as RegExpExecArray));
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return parts.join("");
}

async function stamp(ref: string, hashOf: HashOf): Promise<string> {
  const path = stampable(ref);
  if (path === null) return ref;
  const hash = await hashOf(path);
  return hash === undefined ? ref : `${path}?v=${hash}`;
}

/** A srcset with each candidate's URL stamped. */
async function stampSrcset(value: string, hashOf: HashOf): Promise<string> {
  const entries = await Promise.all(value.split(",").map(async entry => {
    const [, lead = "", url = "", rest = ""] = /^(\s*)(\S+)(.*)$/s.exec(entry) ?? [];
    return url ? `${lead}${await stamp(url, hashOf)}${rest}` : entry;
  }));
  return entries.join(",");
}

/** An absolute URL's path, stamped: the site's base path is taken off first (stamps are by site path) and kept. */
async function stampAbsolute(path: string, hashOf: HashOf, base: string): Promise<string> {
  if (base === "/" || !path.startsWith(base)) return stamp(path, hashOf);
  return `${base}${(await stamp(`/${path.slice(base.length)}`, hashOf)).slice(1)}`;
}

/** A start tag with its references stamped: href, src and srcset; and the content of a link-preview <meta>,
 *  an absolute URL on the site's own address, whose path is taken. */
async function stampTag(name: string, attrs: string, hashOf: HashOf, base: string): Promise<string> {
  const isPreview = name.toLowerCase() === "meta" && /\s(?:property="og:image"|name="twitter:image")/.test(attrs);
  return replaceAsync(attrs, ATTRIBUTE, async m => {
    const [whole, lead, attr, eq, quoted] = m as unknown as [string, string, string, string?, string?];
    if (quoted === undefined || eq === undefined) return whole;
    const q = quoted[0] === '"' || quoted[0] === "'" ? quoted[0] : "";
    const value = q ? quoted.slice(1, -1) : quoted;
    const key = attr.toLowerCase();
    let stamped = value;
    if (key === "href" || key === "src") stamped = await stamp(value, hashOf);
    else if (key === "srcset") stamped = await stampSrcset(value, hashOf);
    else if (key === "content" && isPreview) {
      const at = /^(https?:\/\/[^/"']+)(.*)$/.exec(value);
      if (at) stamped = `${at[1]}${await stampAbsolute(at[2]!, hashOf, base)}`;
    }
    return `${lead}${attr}${eq}${q}${stamped}${q}`;
  });
}

/** An HTML document with every reference to a served file stamped. `base`: the site's base path ("/project/"),
 *  which the absolute URLs (link previews, JSON-LD) carry and the root-relative ones don't yet (base-path.ts). */
export async function stampHtml(html: string, hashOf: HashOf, base = "/"): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  for (const tag of startTags(html)) {
    parts.push(html.slice(last, tag.start));
    const attrsAt = tag.start + 1 + tag.name.length;
    parts.push(`<${tag.name}${await stampTag(tag.name, tag.attrs, hashOf, base)}${html.slice(attrsAt + tag.attrs.length, tag.end)}`);
    last = tag.end;
    if (!tag.content) continue;
    // A raw-text element's content is copied as it is; a JSON-LD block's "image" is stamped.
    const content = html.slice(tag.content.start, tag.content.end);
    parts.push(tag.name.toLowerCase() === "script" && /\stype=["']?application\/ld\+json/i.test(tag.attrs)
      ? await replaceAsync(content, /("image":"https?:\/\/[^/"]+)([^"]*)"/g, async j => `${j[1]}${await stampAbsolute(j[2]!, hashOf, base)}"`)
      : content);
    last = tag.content.end;
  }
  parts.push(html.slice(last));
  return parts.join("");
}

/** A stylesheet with every `url()` to a served file stamped, except one to another stylesheet. */
export async function stampCss(css: string, hashOf: HashOf): Promise<string> {
  return replaceAsync(css, /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, async m => {
    const ref = m[2]!;
    const path = stampable(ref);
    if (path === null || path.endsWith(".css")) return m[0];
    return `url(${m[1]}${await stamp(ref, hashOf)}${m[1]})`;
  });
}
