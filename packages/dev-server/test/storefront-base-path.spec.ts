// The storefront's base path as text (base-path.ts): each place a root-relative reference is put under the path,
// and each one left as written.
import { describe, expect, it } from "vitest";
import { withBase, withBaseCss, withBaseHtml, withNoindex } from "../src/storefront/base-path.js";

const p = { base: "/project/" };

describe("withBase", () => {
  it("puts a root-relative reference under the base path", () => {
    expect(withBase("/", p)).toBe("/project/");
    expect(withBase("/guides/setup/", p)).toBe("/project/guides/setup/");
    expect(withBase("/_pd/base.css?v=b45e00000a", p)).toBe("/project/_pd/base.css?v=b45e00000a");
    expect(withBase("/guides/#install", p)).toBe("/project/guides/#install");
  });

  it("leaves other hosts, relative references and fragments as written", () => {
    for (const ref of ["//cdn.example.com/x.js", "/\\evil.example.com/", "https://example.com/x/", "guides/", "../x/", "#top", "", "mailto:a@b.c"]) {
      expect(withBase(ref, p), ref).toBe(ref);
    }
  });

  it("prefixes a reference already written with the base path again: pages link from the site's root", () => {
    expect(withBase("/project/guides/", p)).toBe("/project/project/guides/");
  });

  it("leaves references into a workbench on the same host, which are its full path", () => {
    const wb = { base: "/project/", workbenchPath: "/project/styleguide/" };
    expect(withBase("/project/styleguide/components/card", wb)).toBe("/project/styleguide/components/card");
    expect(withBase("/styleguide/", wb)).toBe("/project/styleguide/");
  });

  it("changes nothing at the root of a host", () => {
    expect(withBase("/guides/", { base: "/" })).toBe("/guides/");
  });
});

describe("withBaseHtml", () => {
  it("rewrites href, src, poster, action, formaction, <object data> and xlink:href", () => {
    const html = `<a href="/guides/">G</a><img src="/assets/a.png" alt=""><video poster="/assets/p.jpg"></video>`
      + `<form action="/search/"><button formaction="/go/">Go</button></form><object data="/assets/x.svg"></object>`
      + `<svg><use xlink:href="/assets/i.svg#a"></use><use href="/assets/i.svg#b"></use></svg>`;
    expect(withBaseHtml(html, p)).toBe(`<a href="/project/guides/">G</a><img src="/project/assets/a.png" alt="">`
      + `<video poster="/project/assets/p.jpg"></video><form action="/project/search/"><button formaction="/project/go/">Go</button></form>`
      + `<object data="/project/assets/x.svg"></object>`
      + `<svg><use xlink:href="/project/assets/i.svg#a"></use><use href="/project/assets/i.svg#b"></use></svg>`);
  });

  it("rewrites each candidate of srcset and imagesrcset", () => {
    expect(withBaseHtml(`<img srcset="/_pd/images/a.1.320.webp 320w, /_pd/images/a.1.640.webp 640w" src="/_pd/images/a.1.640.webp" alt="">`, p))
      .toBe(`<img srcset="/project/_pd/images/a.1.320.webp 320w, /project/_pd/images/a.1.640.webp 640w" src="/project/_pd/images/a.1.640.webp" alt="">`);
    expect(withBaseHtml(`<link rel="preload" as="image" imagesrcset="/a.webp 1x,/b.webp 2x">`, p))
      .toBe(`<link rel="preload" as="image" imagesrcset="/project/a.webp 1x,/project/b.webp 2x">`);
  });

  it("rewrites single-quoted and unquoted values, and keeps their quoting", () => {
    expect(withBaseHtml(`<a href='/a/'>A</a><a href=/b/>B</a>`, p)).toBe(`<a href='/project/a/'>A</a><a href=/project/b/>B</a>`);
  });

  it("rewrites the url= of a meta refresh, and only of a refresh", () => {
    expect(withBaseHtml(`<meta http-equiv="refresh" content="0; url=/guides/setup/">`, p))
      .toBe(`<meta http-equiv="refresh" content="0; url=/project/guides/setup/">`);
    expect(withBaseHtml(`<meta http-equiv="refresh" content="0;URL='/x/'">`, p)).toBe(`<meta http-equiv="refresh" content="0;URL='/project/x/'">`);
    expect(withBaseHtml(`<meta name="description" content="0; url=/x/">`, p)).toBe(`<meta name="description" content="0; url=/x/">`);
  });

  it("rewrites url() in a style attribute and in a <style> element", () => {
    expect(withBaseHtml(`<div style="background: url(/assets/bg.jpg)"></div><style>.a { background: url("/assets/b.png") }</style>`, p))
      .toBe(`<div style="background: url(/project/assets/bg.jpg)"></div><style>.a { background: url("/project/assets/b.png") }</style>`);
  });

  it("leaves text, comments, scripts, data-* attributes and code examples as written", () => {
    const html = `<p>Write <code>&lt;img src="/assets/a.png"&gt;</code> or src="/x"</p><!-- <a href="/c/"> -->`
      + `<pre><code>&lt;a href="/guides/"&gt;</code></pre><script>fetch("/search.json")</script>`
      + `<script type="application/ld+json">{"url":"https://example.com/project/"}</script>`
      + `<div data-src="/assets/lazy.jpg"></div><textarea><a href="/t/"></textarea>`;
    expect(withBaseHtml(html, p)).toBe(html);
  });

  it("leaves a link into the same-host workbench", () => {
    const wb = { base: "/project/", workbenchPath: "/project/styleguide/" };
    expect(withBaseHtml(`<a href="/project/styleguide/components/card">Card</a><a href="/">Home</a>`, wb))
      .toBe(`<a href="/project/styleguide/components/card">Card</a><a href="/project/">Home</a>`);
  });

  it("changes nothing at the root of a host", () => {
    const html = `<a href="/guides/">G</a><style>a{background:url(/x.png)}</style>`;
    expect(withBaseHtml(html, { base: "/" })).toBe(html);
  });
});

describe("withBaseCss", () => {
  it("rewrites url() in each quoting, and @import's string form", () => {
    expect(withBaseCss(`@import "/_pd/a.css"; @import url('/_pd/b.css'); .a{src:url(/assets/f.woff2?v=1) format("woff2")}`, p))
      .toBe(`@import "/project/_pd/a.css"; @import url('/project/_pd/b.css'); .a{src:url(/project/assets/f.woff2?v=1) format("woff2")}`);
  });

  it("leaves data: URLs, other hosts and relative url()s", () => {
    const css = `.a{background:url(data:image/png;base64,AAA)}.b{background:url(//cdn.example.com/x.png)}.c{background:url(img/x.png)}`;
    expect(withBaseCss(css, p)).toBe(css);
  });
});

describe("withNoindex", () => {
  it("puts a robots noindex meta first in the head, once", () => {
    const doc = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n</head><body></body></html>`;
    const out = withNoindex(doc);
    expect(out).toBe(`<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta name="robots" content="noindex">\n<meta charset="UTF-8">\n</head><body></body></html>`);
    expect(withNoindex(out)).toBe(out);
  });
});
