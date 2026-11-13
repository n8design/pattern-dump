// The storefront's content stamps as text (asset-stamps.ts): each kind of reference, what is left as written,
// and that a missing file stays unstamped.
import { describe, expect, it } from "vitest";
import { stampCss, stampHtml, type HashOf } from "../src/storefront/asset-stamps.js";

const files: Record<string, string> = {
  "/_pd/base.css": "b45e00000a",
  "/_pd/components/partials/nav.css": "c0ffee0001",
  "/_pd/scripts/switch.js": "5c41970002",
  "/assets/images/share.png": "54a4e00003",
  "/assets/images/a.webp": "aaaa000004",
  "/assets/images/b.webp": "bbbb000005",
  "/assets/fonts/serif.woff2": "f0e7000006",
};
const asked: string[] = [];
const hashOf: HashOf = async path => { asked.push(path); return files[path]; };

describe("stampHtml", () => {
  it("stamps href and src on /_pd/ and /assets/", async () => {
    expect(await stampHtml(`<link rel="stylesheet" href="/_pd/base.css"><script src="/_pd/scripts/switch.js" defer></script>`, hashOf))
      .toBe(`<link rel="stylesheet" href="/_pd/base.css?v=b45e00000a"><script src="/_pd/scripts/switch.js?v=5c41970002" defer></script>`);
  });

  it("replaces a stamp already there (pd dev's ?v=<n>, an old hash)", async () => {
    expect(await stampHtml(`<link rel="stylesheet" href="/_pd/base.css?v=3">`, hashOf)).toBe(`<link rel="stylesheet" href="/_pd/base.css?v=b45e00000a">`);
  });

  it("stamps each srcset entry, keeping its descriptor", async () => {
    expect(await stampHtml(`<img srcset="/assets/images/a.webp 480w, /assets/images/b.webp 960w" src="/assets/images/b.webp">`, hashOf))
      .toBe(`<img srcset="/assets/images/a.webp?v=aaaa000004 480w, /assets/images/b.webp?v=bbbb000005 960w" src="/assets/images/b.webp?v=bbbb000005">`);
  });

  it("stamps og:image, twitter:image and JSON-LD image on the site's own address", async () => {
    const html = `<meta property="og:image" content="https://site.test/assets/images/share.png">\n`
      + `<meta name="twitter:image" content="https://site.test/assets/images/share.png">\n`
      + `<script type="application/ld+json">{"@type":"Article","image":"https://site.test/assets/images/share.png"}</script>`;
    expect(await stampHtml(html, hashOf)).toBe(html.replaceAll("share.png", "share.png?v=54a4e00003"));
  });

  it("leaves image variants as written, and never looks them up: their name is their key", async () => {
    asked.length = 0;
    const html = `<img src="/_pd/images/images/harbour.0123456789.960.webp" srcset="/_pd/images/images/harbour.abcdefabcd.480.webp 480w">`;
    expect(await stampHtml(html, hashOf)).toBe(html);
    expect(asked).toEqual([]);
  });

  it("leaves page links, previews, other hosts, other queries, fragments and missing files as written", async () => {
    const html = [
      `<a href="/guides/">`, `<iframe src="/preview/components/callout">`, `<a href="https://pd.localhost:4000/components/callout">`,
      `<link rel="icon" href="//cdn.example/assets/x.png">`, `<img src="/assets/images/a.webp?w=1">`, `<use href="/assets/icons.svg#star">`,
      `<img src="/assets/images/gone.png">`, `<meta property="og:image" content="https://site.test/assets/images/gone.png">`,
    ].join("\n");
    expect(await stampHtml(html, hashOf)).toBe(html);
  });

  it("stamps attributes of elements only, never text: a code example that quotes a reference is shown as written", async () => {
    // A plain fence writes its quotes as they are; a comment, a <script>'s code and a <textarea>'s text are text too.
    const text = [
      `<pre><code>&lt;img src="/assets/images/a.webp" alt=""&gt;\n&lt;link href="/_pd/base.css"&gt;</code></pre>`,
      `<!-- <img src="/assets/images/a.webp"> -->`,
      `<script>var html = '<img src="/assets/images/a.webp">';</script>`,
      `<textarea><link href="/_pd/base.css"></textarea>`,
      `<p>src="/assets/images/a.webp" in a sentence</p>`,
    ].join("\n");
    expect(await stampHtml(text, hashOf)).toBe(text);
  });

  it("reads an element's attributes as the parser does: any quoting, and a quoted value that holds markup", async () => {
    expect(await stampHtml(`<div data-raw="<img src=&quot;/assets/images/a.webp&quot;>"><img src='/assets/images/a.webp' alt="x"></div>`, hashOf))
      .toBe(`<div data-raw="<img src=&quot;/assets/images/a.webp&quot;>"><img src='/assets/images/a.webp?v=aaaa000004' alt="x"></div>`);
    expect(await stampHtml(`<IMG SRC=/assets/images/a.webp alt=x>`, hashOf)).toBe(`<IMG SRC=/assets/images/a.webp?v=aaaa000004 alt=x>`);
    // The attribute named, not a look-alike inside another value.
    expect(await stampHtml(`<span title='src="/assets/images/a.webp"'></span>`, hashOf)).toBe(`<span title='src="/assets/images/a.webp"'></span>`);
  });
});

describe("stampCss", () => {
  it("stamps url() to fonts and images, quoted or not", async () => {
    expect(await stampCss(`@font-face{src:url("/assets/fonts/serif.woff2") format("woff2")}.x{background:url(/assets/images/a.webp)}`, hashOf))
      .toBe(`@font-face{src:url("/assets/fonts/serif.woff2?v=f0e7000006") format("woff2")}.x{background:url(/assets/images/a.webp?v=aaaa000004)}`);
  });

  it("never stamps a url() to another stylesheet, so a stylesheet's hash never needs its own", async () => {
    asked.length = 0;
    const css = `@import url("/_pd/components/partials/nav.css");`;
    expect(await stampCss(css, hashOf)).toBe(css);
    expect(asked).toEqual([]);
  });

  it("leaves data: URLs, other hosts and missing files as written", async () => {
    const css = `.a{background:url(data:image/png;base64,AAAA)}.b{background:url(https://cdn.example/x.png)}.c{background:url(/assets/gone.png)}`;
    expect(await stampCss(css, hashOf)).toBe(css);
  });
});
