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
// The pass only rewrites text. `hashOf` says what a path's stamp is: the server answers it by serving the
// path to itself (routes.ts), so a stylesheet's hash covers its own stamped `url()`s.

/** The stamp of a served path, or undefined when nothing is served there. */
export type HashOf = (path: string) => Promise<string | undefined>;

const SERVED = String.raw`\/(?:_pd|assets)\/[^"'()\s?#]+`;

/** `path` or `path?v=…`: the path, when the reference may be stamped; otherwise null. */
function stampable(ref: string): string | null {
  const m = new RegExp(`^(${SERVED})(?:\\?v=[^"'()\\s#&]*)?$`).exec(ref);
  return m ? m[1]! : null;
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

/** An HTML document with every reference to a served file stamped. */
export async function stampHtml(html: string, hashOf: HashOf): Promise<string> {
  let out = await replaceAsync(html, /\b(href|src)="([^"]*)"/g, async m => `${m[1]}="${await stamp(m[2]!, hashOf)}"`);
  out = await replaceAsync(out, /\bsrcset="([^"]*)"/g, async m => {
    const entries = await Promise.all(m[1]!.split(",").map(async entry => {
      const [, lead = "", url = "", rest = ""] = /^(\s*)(\S+)(.*)$/s.exec(entry) ?? [];
      return url ? `${lead}${await stamp(url, hashOf)}${rest}` : entry;
    }));
    return `srcset="${entries.join(",")}"`;
  });
  // Absolute URLs on the site's own address: link previews and structured data.
  out = await replaceAsync(out, /(<meta (?:property="og:image"|name="twitter:image") content="https?:\/\/[^/"]+)([^"]*)"/g,
    async m => `${m[1]}${await stamp(m[2]!, hashOf)}"`);
  out = await replaceAsync(out, /("image":"https?:\/\/[^/"]+)([^"]*)"/g, async m => `${m[1]}${await stamp(m[2]!, hashOf)}"`);
  return out;
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
