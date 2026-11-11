// A page's old routes (redirects.ts): checked across the site (an old route that is a page, one two pages
// claim, one the server answers itself), and each answered with a page that forwards to the page at once.
import { describe, expect, it } from "vitest";
import { readFrontmatterStrict } from "../src/frontmatter.js";
import type { PageFile } from "../src/storefront/pages.js";
import { redirectProblems, redirectStub } from "../src/storefront/redirects.js";

const file = (path: string, route: string, frontmatter: string): PageFile =>
  ({ route, path, file: `/x/${path}`, frontmatter: readFrontmatterStrict(`---\n${frontmatter}---\n\nBody.\n`) });
const site = (...files: PageFile[]) => new Map(files.map(f => [f.route, f]));

describe("redirectProblems", () => {
  it("finds nothing wrong with old routes that are free", () => {
    expect(redirectProblems(site(
      file("index.md", "/", "title: Home\n"),
      file("guides/setup.md", "/guides/setup/", "title: Setup\nredirectFrom: [/setup/, /start/]\n"),
      file("about.md", "/about/", "title: About\nredirectFrom: /who/\n"),
    ))).toEqual([]);
  });

  it("refuses an old route that is a page", () => {
    expect(redirectProblems(site(
      file("index.md", "/", "title: Home\n"),
      file("about.md", "/about/", "title: About\n"),
      file("guides/setup.md", "/guides/setup/", "title: Setup\nredirectFrom: [/about/]\n"),
    ))).toEqual([`guides/setup.md:3: redirectFrom "/about/" is the page about.md: a route can't both be a page and forward to one`]);
  });

  it("refuses an old route two pages claim", () => {
    expect(redirectProblems(site(
      file("a.md", "/a/", "title: A\nredirectFrom: /old/\n"),
      file("b.md", "/b/", "title: B\nredirectFrom: [/older/, /old/]\n"),
    ))).toEqual([`b.md:3: redirectFrom "/old/" is also claimed by a.md: one old route forwards to one page`]);
  });

  it("refuses an old route the server answers itself", () => {
    for (const old of ["/preview/x/", "/_pd/x/", "/assets/x/", "/api/x/", "/source/x/"]) {
      expect(redirectProblems(site(file("a.md", "/a/", `title: A\nredirectFrom: ${old}\n`))), old)
        .toEqual([`a.md:3: redirectFrom "${old}" is under ${old.slice(0, old.indexOf("/", 1) + 1)}, which Pattern Dump serves itself`]);
    }
  });

  it("leaves a badly shaped old route to the page's own check", () => {
    expect(redirectProblems(site(file("a.md", "/a/", "title: A\nredirectFrom: [old, /old]\n")))).toEqual([]);
  });

  it("refuses an old route at or under the path of a workbench published on the same host", () => {
    const at = (old: string) => redirectProblems(site(file("a.md", "/a/", `title: A\nredirectFrom: ${old}\n`)), "/workbench/");
    expect(at("/workbench/")).toEqual([`a.md:3: redirectFrom "/workbench/" is at /workbench/, where the workbench is published on this host (storefront.workbenchUrl), so the workbench would overwrite it there`]);
    expect(at("/workbench/components/note/")).toEqual([`a.md:3: redirectFrom "/workbench/components/note/" is under /workbench/, where the workbench is published on this host (storefront.workbenchUrl), so the workbench would overwrite it there`]);
  });

  it("takes the workbench's path as whole segments, and checks nothing without one", () => {
    expect(redirectProblems(site(file("a.md", "/a/", "title: A\nredirectFrom: [/workbench-notes/, /work/]\n")), "/workbench/")).toEqual([]);
    expect(redirectProblems(site(file("a.md", "/a/", "title: A\nredirectFrom: /workbench/\n")))).toEqual([]);
  });
});

describe("redirectStub", () => {
  it("forwards at once, names its target as canonical, is never indexed, and links to it", () => {
    expect(redirectStub({ route: "/guides/setup/", title: "Setup", siteUrl: "https://example.test/", lang: "en" })).toBe(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Moved to Setup</title>
<link rel="canonical" href="https://example.test/guides/setup/">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=/guides/setup/">
</head>
<body>
<p>This page has moved to <a href="/guides/setup/">Setup</a>.</p>
</body>
</html>
`);
  });

  it("names no canonical without the site's address, and escapes the title", () => {
    const html = redirectStub({ route: "/a/", title: `A <b> & "c"`, siteUrl: undefined, lang: "de" });
    expect(html).not.toContain("canonical");
    expect(html).toContain(`<title>Moved to A &lt;b&gt; &amp; "c"</title>`);
    expect(html).toContain(`<html lang="de">`);
  });
});
