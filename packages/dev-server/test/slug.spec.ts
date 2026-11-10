// Heading anchors (storefront/slug.ts, the heading pass in markdown.ts): github-slugger's rules and dedupe,
// checked against github-slugger 2.0.0's own fixtures (test/fixtures/github-slugger-2.0.0.json, copied as
// they are from its repository; ISC licence, Copyright (c) 2015 Dan Flettre), plus the cases a storefront
// page meets: the anchor of every heading level, in frame mode only.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderDoc } from "../src/markdown.js";
import type { PageHeading } from "../src/storefront/derived.js";
import { slug, Slugger } from "../src/storefront/slug.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/github-slugger-2.0.0.json", import.meta.url), "utf8")) as
  { name: string; input: string; expected: string }[];

describe("Slugger: github-slugger's fixtures, in order, through one slugger", () => {
  const slugger = new Slugger();
  for (const f of fixtures) {
    it(f.name, () => { expect(slugger.slug(f.input)).toBe(f.expected); });
  }
});

describe("Slugger", () => {
  it("dedupes, and suffixes a literal that equals an earlier suffix again", () => {
    const s = new Slugger();
    expect(["Layouts", "Layouts", "Layouts 1"].map(t => s.slug(t))).toEqual(["layouts", "layouts-1", "layouts-1-1"]);
  });

  it("keeps non-ASCII letters as they are", () => {
    expect(slug("Größe & Übersicht")).toBe("größe--übersicht");
    expect(slug("日本語の見出し")).toBe("日本語の見出し");
  });
});

describe("renderDoc's heading pass", () => {
  const frame = async (md: string) => {
    const headings: PageHeading[] = [];
    const html = await renderDoc(md, async () => "", new Map(), { embed: "frame", workbenchUrl: "https://wb.example/", problems: [], headings });
    return { html, headings };
  };

  it("anchors the findings' table, every level, in document order", async () => {
    const { html, headings } = await frame([
      "# Pages", "## Layouts", "### Layouts", "#### Layouts 1", "##### Größe & Übersicht", "###### 日本語の見出し",
      "## The `pd-` tags *and* [links](https://example.com/)", "## 🎉", "## 🎉",
    ].join("\n\n"));
    expect(headings).toEqual([
      { level: 1, text: "Pages", anchor: "pages" },
      { level: 2, text: "Layouts", anchor: "layouts" },
      { level: 3, text: "Layouts", anchor: "layouts-1" },
      { level: 4, text: "Layouts 1", anchor: "layouts-1-1" },
      { level: 5, text: "Größe & Übersicht", anchor: "größe--übersicht" },
      { level: 6, text: "日本語の見出し", anchor: "日本語の見出し" },
      { level: 2, text: "The pd- tags and links", anchor: "the-pd--tags-and-links" },
      { level: 2, text: "🎉", anchor: "section" },
      { level: 2, text: "🎉", anchor: "section-1" },
    ]);
    expect(html).toContain(`<h1 id="pages">Pages</h1>`);
    expect(html).toContain(`<h6 id="日本語の見出し">日本語の見出し</h6>`);
    expect(html).toContain(`<h2 id="the-pd--tags-and-links">The <code>pd-</code> tags <em>and</em> <a href="https://example.com/">links</a></h2>`);
  });

  it("reads escapes and entities as the text they stand for", async () => {
    expect((await frame("## A \\* B &amp; C")).headings).toEqual([{ level: 2, text: "A * B & C", anchor: "a--b--c" }]);
  });

  it("is the same on every render: one slugger per page", async () => {
    expect((await frame("## A\n\n## A")).headings.map(h => h.anchor)).toEqual(["a", "a-1"]);
    expect((await frame("## A\n\n## A")).headings.map(h => h.anchor)).toEqual(["a", "a-1"]);
  });

  it("sets no ids in inline mode (the workbench's docs panel)", async () => {
    expect(await renderDoc("## Layouts\n\n### Größe", async () => "", new Map())).toBe(`<h2>Layouts</h2>\n<h3>Größe</h3>\n`);
  });
});
