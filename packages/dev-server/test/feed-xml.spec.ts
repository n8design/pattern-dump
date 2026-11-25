// The feed serialisers (feeds.ts): what Atom 1.0 (RFC 4287) and RSS 2.0 (its spec and the RSS Advisory Board's
// profile) require, each output parsed as XML, dates and escaping. The rules are the plan's F0 tables.
import { describe, expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { atomDate, atomXml, checkFeed, rssDate, rssXml, type Feed } from "../src/storefront/feeds.js";
import { escapeXml } from "../src/storefront/xml.js";

/** An element of a parsed document: its name, attributes, text and children. */
interface El { name: string; attrs: Record<string, string>; text: string; children: El[] }

/** Parses `xml` with namespaces on; a document that isn't well formed throws. */
function parse(xml: string): El {
  const parser = new SaxesParser({ xmlns: true });
  const stack: El[] = [];
  let root: El | undefined;
  parser.on("opentag", tag => {
    const el: El = { name: tag.name, attrs: Object.fromEntries(Object.entries(tag.attributes).map(([k, v]) => [k, typeof v === "string" ? v : v.value])), text: "", children: [] };
    stack.at(-1)?.children.push(el);
    stack.push(el);
    root ??= el;
  });
  parser.on("text", text => { const el = stack.at(-1); if (el) el.text += text; });
  parser.on("closetag", () => { stack.pop(); });
  parser.write(xml).close();
  return root!;
}
const kids = (el: El, name: string) => el.children.filter(c => c.name === name);
const one = (el: El, name: string) => {
  const found = kids(el, name);
  expect(found, `${el.name} > ${name}`).toHaveLength(1);
  return found[0]!;
};

const FEED: Feed = {
  source: "articles/index.md",
  id: "https://example.test/articles/",
  title: "Articles",
  subtitle: "What we write about",
  home: "https://example.test/articles/",
  updated: "2026-11-20",
  author: { name: "The bench", uri: "https://example.test/about/" },
  language: "en-GB",
  entries: [
    { id: "https://example.test/articles/old-name/", title: "Harbour", url: "https://example.test/articles/harbour/",
      published: "2026-11-01", updated: "2026-11-20", summary: "Cable cars, and how a listing shows a page's image." },
    { id: "https://example.test/articles/plain/", title: "Plain", url: "https://example.test/articles/plain/",
      published: "2026-10-02", updated: "2026-10-02", summary: null },
  ],
};
const SELF = "https://example.test/articles/feed.xml";

describe("dates", () => {
  it("writes a day as its midnight in UTC for Atom (RFC 3339), and in RFC 822 for RSS", () => {
    expect(atomDate("2026-11-13")).toBe("2026-11-13T00:00:00Z");
    expect(rssDate("2026-11-13")).toBe("Fri, 13 Nov 2026 00:00:00 GMT");
    expect(rssDate("0050-03-01")).toBe("Tue, 01 Mar 0050 00:00:00 GMT");
    expect(() => atomDate("2026-11-13T10:00:00Z")).toThrow(/not a day/);
  });

  it("is the same day wherever it is written", () => {
    const tz = process.env.TZ;
    try {
      for (const zone of ["America/Los_Angeles", "Pacific/Kiritimati"]) {
        process.env.TZ = zone;
        expect(rssDate("2026-11-13"), zone).toBe("Fri, 13 Nov 2026 00:00:00 GMT");
      }
    } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
  });
});

describe("atomXml (RFC 4287)", () => {
  const doc = parse(atomXml(FEED, SELF));

  it("is a feed in the Atom namespace with exactly one id, title and updated (4.1.1)", () => {
    expect(doc.name).toBe("feed");
    expect(doc.attrs["xmlns"]).toBe("http://www.w3.org/2005/Atom");
    expect(one(doc, "id").text).toBe("https://example.test/articles/");
    expect(one(doc, "title").text).toBe("Articles");
    expect(one(doc, "title").attrs["type"]).toBe("text");
    expect(one(doc, "updated").text).toBe("2026-11-20T00:00:00Z");
    expect(one(doc, "subtitle").text).toBe("What we write about");
    expect(one(doc, "generator").text).toBe("Pattern Dump");
  });

  it("has an author with one name, and one alternate and one self link (4.1.1, 3.2)", () => {
    const author = one(doc, "author");
    expect(one(author, "name").text).toBe("The bench");
    expect(one(author, "uri").text).toBe("https://example.test/about/");
    const links = kids(doc, "link").map(l => l.attrs);
    expect(links).toEqual([
      { rel: "alternate", type: "text/html", href: "https://example.test/articles/" },
      { rel: "self", type: "application/atom+xml", href: SELF },
    ]);
  });

  it("gives each entry one id, title and updated, its page as alternate, its date as published (4.1.2)", () => {
    const entries = kids(doc, "entry");
    expect(entries).toHaveLength(2);
    const [first, second] = entries as [El, El];
    expect(one(first, "id").text).toBe("https://example.test/articles/old-name/");
    expect(one(first, "title").text).toBe("Harbour");
    expect(one(first, "link").attrs).toEqual({ rel: "alternate", type: "text/html", href: "https://example.test/articles/harbour/" });
    expect(one(first, "published").text).toBe("2026-11-01T00:00:00Z");
    expect(one(first, "updated").text).toBe("2026-11-20T00:00:00Z");
    expect(one(first, "summary").attrs["type"]).toBe("text");
    expect(one(first, "summary").text).toBe("Cable cars, and how a listing shows a page's image.");
    // An entry without a summary has none: its title and link are enough.
    expect(kids(second, "summary")).toEqual([]);
    // The feed's author covers every entry.
    expect(kids(first, "author")).toEqual([]);
  });
});

describe("rssXml (RSS 2.0, the profile)", () => {
  const doc = parse(rssXml(FEED, SELF));
  const channel = one(doc, "channel");

  it("is RSS 2.0 with the namespaces it uses, and a channel with title, link and description", () => {
    expect(doc.name).toBe("rss");
    expect(doc.attrs).toEqual({ version: "2.0", "xmlns:atom": "http://www.w3.org/2005/Atom", "xmlns:dc": "http://purl.org/dc/elements/1.1/" });
    expect(one(channel, "title").text).toBe("Articles");
    expect(one(channel, "link").text).toBe("https://example.test/articles/");
    expect(one(channel, "description").text).toBe("What we write about");
    expect(one(channel, "language").text).toBe("en-GB");
    expect(one(channel, "lastBuildDate").text).toBe("Fri, 20 Nov 2026 00:00:00 GMT");
    expect(one(channel, "atom:link").attrs).toEqual({ rel: "self", type: "application/rss+xml", href: SELF });
  });

  it("gives each item its title, link, a guid that is no permalink, its date and a dc:creator, never <author>", () => {
    const items = kids(channel, "item");
    expect(items).toHaveLength(2);
    const first = items[0]!;
    expect(one(first, "title").text).toBe("Harbour");
    expect(one(first, "link").text).toBe("https://example.test/articles/harbour/");
    // The oldest route is not the page's URL after a move, so the guid says it is no permalink.
    expect(one(first, "guid").attrs).toEqual({ isPermaLink: "false" });
    expect(one(first, "guid").text).toBe("https://example.test/articles/old-name/");
    expect(one(first, "pubDate").text).toBe("Sun, 01 Nov 2026 00:00:00 GMT");
    expect(one(first, "dc:creator").text).toBe("The bench");
    expect(one(first, "description").text).toBe("Cable cars, and how a listing shows a page's image.");
    expect(kids(first, "author")).toEqual([]);
    expect(kids(first, "enclosure")).toEqual([]);
    expect(kids(items[1]!, "description")).toEqual([]);
  });
});

describe("text and ids", () => {
  const tricky: Feed = {
    ...FEED, title: `Fish & chips <b>"quoted"</b> 'single' ]]> end`,
    entries: [{ ...FEED.entries[0]!, id: "https://example.test/Articles/%7Eold/", title: "A\u0000B\u0008C￾\uD800D",
      summary: "1 < 2 && 3 > 2" }],
  };

  for (const [format, write] of [["atom", atomXml], ["rss", rssXml]] as const) {
    it(`${format}: escapes markup and drops what XML can't carry, never CDATA, and keeps an id as it is`, () => {
      const xml = write(tricky, SELF);
      expect(xml).not.toContain("<![CDATA[");
      expect(xml).toContain("]]&gt; end");
      const doc = parse(xml);
      const container = format === "atom" ? doc : one(doc, "channel");
      expect(one(container, "title").text).toBe(`Fish & chips <b>"quoted"</b> 'single' ]]> end`);
      const entry = kids(container, format === "atom" ? "entry" : "item")[0]!;
      expect(one(entry, "title").text).toBe("ABCD");
      expect(one(entry, format === "atom" ? "summary" : "description").text).toBe("1 < 2 && 3 > 2");
      // Case and percent-encoding are part of an id.
      expect(one(entry, format === "atom" ? "id" : "guid").text).toBe("https://example.test/Articles/%7Eold/");
    });
  }

  it("is the same bytes for the same feed", () => {
    expect(atomXml(FEED, SELF)).toBe(atomXml(structuredClone(FEED), SELF));
    expect(rssXml(FEED, SELF)).toBe(rssXml(structuredClone(FEED), SELF));
  });

  it("escapeXml keeps a surrogate pair and drops a lone one", () => {
    expect(escapeXml("a😀b\uDC00c")).toBe("a😀bc");
  });
});

describe("checkFeed", () => {
  it("passes a feed that has what its format requires", () => {
    expect(checkFeed(FEED, "atom")).toEqual([]);
    expect(checkFeed(FEED, "rss")).toEqual([]);
  });

  it("names an Atom feed's missing author, and an RSS feed's missing description, with where to give it", () => {
    expect(checkFeed({ ...FEED, author: undefined }, "atom")).toEqual(["articles/index.md: an Atom feed needs an author: set site.feeds.author.name"]);
    expect(checkFeed({ ...FEED, author: undefined }, "rss")).toEqual([]);
    expect(checkFeed({ ...FEED, subtitle: null }, "rss")).toEqual([
      "articles/index.md: an RSS feed needs a description: give the folder's index.md a description"]);
    expect(checkFeed({ ...FEED, source: "site.feeds", subtitle: " " }, "rss")).toEqual([
      "site.feeds: an RSS feed needs a description: give the home page a description"]);
    expect(checkFeed({ ...FEED, title: "" }, "atom")).toEqual(["articles/index.md: the feed has no title: give it one"]);
  });
});
