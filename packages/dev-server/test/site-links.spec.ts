// The internal link check (storefront/links.ts) over a built storefront, as the crawl hands it over: every href, src
// and srcset of every element on a site page resolves to a built file or page, a #fragment to an id in the target, a
// link into the workbench to a component and its variant; other hosts are listed, not fetched; text is never a link.
import { describe, expect, it } from "vitest";
import { checkLinks, type LinkSite } from "../src/storefront/links.js";

const page = (body: string) => `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;
const SITE: Omit<LinkSite, "documents" | "pages"> & { documents: Record<string, string> } = {
  built: new Set(["/", "/about/", "/guides/", "/guides/setup/", "/setup/", "/404.html", "/preview/components/callout",
    "/assets/images/a.svg", "/_pd/base.css", "/robots.txt"]),
  documents: {
    "/guides/setup/": page(`<h1 id="setup">Setup</h1><h2 id="pages">Pages</h2><a name="legacy"></a>`),
    "/setup/": page(`<a href="/guides/setup/">Moved</a>`),
    "/preview/components/callout": page(`<div>preview</div>`),
  },
  siteUrl: "https://site.test/",
  workbench: { url: "https://wb.test/", routes: new Set(["", "components", "components/callout", "components/callout/variants"]),
    variants: new Map([["components/callout", ["warning"]]]) },
};
function check(pages: Record<string, string>, over: Partial<LinkSite> = {}) {
  const documents = new Map(Object.entries({ ...SITE.documents, ...pages }));
  return checkLinks({ ...SITE, documents, pages: Object.keys(pages), ...over });
}

describe("checkLinks", () => {
  it("passes what resolves: pages, folders, relative links, files, srcset, fragments, stubs, previews, the site's own URLs, the workbench", () => {
    const r = check({ "/about/": page(`
      <a href="/guides/">guides</a> <a href="/guides">no slash</a> <a href="../guides/setup/#pages">relative</a>
      <a href="/guides/setup/index.html#legacy">index.html, a[name]</a> <a href="#top">here</a> <span id="top"></span>
      <a href="/setup/">a redirect stub</a> <iframe src="/preview/components/callout" title="x"></iframe>
      <link rel="stylesheet" href="/_pd/base.css?v=0123456789"> <img src="/assets/images/a.svg" srcset="/assets/images/a.svg 1x" alt="">
      <link rel="canonical" href="https://site.test/about/"> <a href="https://site.test/guides/setup/#setup">absolute</a>
      <a href="https://wb.test/components/callout#warning">workbench</a> <a href="https://wb.test/components">folder</a>
      <a href="mailto:a@b.test">mail</a> <a href="tel:+1">phone</a>`) });
    expect(r.problems).toEqual([]);
    expect(r.references).toBe(16);
  });

  it("reports what doesn't, naming the page and the element", () => {
    const r = check({ "/about/": page(`
      <a href="/guides/instal/">a typo</a> <a href="/guides/setup/#no-such">a missing anchor</a> <a href="#nowhere">a local one</a>
      <img src="/assets/images/gone.svg" alt=""> <a href="https://site.test/old/">the site's own, gone</a>
      <a href="https://wb.test/components/calout">a renamed component</a> <a href="https://wb.test/components/callout#danger">a variant</a>`) });
    expect(r.problems).toEqual([
      `/about/: <a href="/guides/instal/">: no page or file is built at /guides/instal/`,
      `/about/: <a href="/guides/setup/#no-such">: /guides/setup/ has no element with id "no-such"`,
      `/about/: <a href="#nowhere">: /about/ has no element with id "nowhere"`,
      `/about/: <img src="/assets/images/gone.svg">: no page or file is built at /assets/images/gone.svg`,
      `/about/: <a href="https://site.test/old/">: no page or file is built at /old/`,
      `/about/: <a href="https://wb.test/components/calout">: the workbench has no components/calout`,
      `/about/: <a href="https://wb.test/components/callout#danger">: components/callout has no variant "danger" in the workbench`,
    ]);
  });

  it("lists other hosts with the pages that link them, and doesn't check them", () => {
    const r = check({ "/": page(`<a href="https://example.com/x">x</a>`), "/about/": page(`<a href="https://example.com/x">x</a> <img src="//cdn.test/a.png" alt="">`) });
    expect(r.problems).toEqual([]);
    expect([...r.external]).toEqual([["https://example.com/x", ["/", "/about/"]], ["//cdn.test/a.png", ["/about/"]]]);
  });

  it("checks the site pages only: a preview or a redirect stub isn't a source, and text is never a link", () => {
    const r = check({ "/about/": page(`<pre><code>&lt;a href="/nope/"&gt;</code></pre><p>href="/nope/"</p><script>var a = '<a href="/nope/">';</script>`) },
      { documents: new Map(Object.entries({ ...SITE.documents, "/setup/": page(`<a href="/nope/">x</a>`),
        "/about/": page(`<pre><code>&lt;a href="/nope/"&gt;</code></pre><p>href="/nope/"</p><script>var a = '<a href="/nope/">';</script>`) })) });
    expect(r.problems).toEqual([]);
  });

  it("a workbench on the site's own host is checked by its path", () => {
    const r = check({ "/about/": page(`<a href="/workbench/components/callout#warning">ok</a> <a href="/workbench/components/nope">gone</a>`) },
      { workbench: { ...SITE.workbench!, url: "/workbench/" } });
    expect(r.problems).toEqual([`/about/: <a href="/workbench/components/nope">: the workbench has no components/nope`]);
  });
});
