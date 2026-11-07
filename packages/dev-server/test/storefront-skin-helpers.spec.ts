// The storefront bench skin's helpers: what a page shows about its own structure, derived from its
// rendered body and the nav.
import { describe, expect, it } from "vitest";
import { skinChapters, skinIndex, skinMarquee, skinNext, skinSections, skinTitleEm } from "../../../storefront-bench/src/helpers/skin.js";

/** The bench's nav as the storefront gives it to a page, with `current` on the given route. */
const nav = (current: string) => [
  { route: "/", title: "Storefront bench", description: "Home." },
  { route: "/guides/", title: "Guides", description: "Longer texts.", children: [{ route: "/guides/setup/", title: "Setup" }] },
  { route: "/about/", title: "About" },
].map(e => ({
  ...e,
  ...(e.route === current ? { current: true } : {}),
  ...(e.children ? { children: e.children.map(c => ({ ...c, ...(c.route === current ? { current: true } : {}) })) } : {}),
}));

describe("skinChapters", () => {
  it("cuts a body at its h2 headings: the intro, then one numbered chapter each", () => {
    const body = `<p>Intro.</p>\n<h2>Pages</h2>\n<p>One.</p>\n<h2 id="x">Layouts &amp; partials</h2>\n<p>Two.</p>\n<ul><li>x</li></ul>\n`;
    expect(skinChapters(body)).toEqual({
      intro: "<p>Intro.</p>",
      chapters: [
        { number: "01", title: "Pages", html: "<p>One.</p>" },
        { number: "02", title: "Layouts & partials", html: "<p>Two.</p>\n<ul><li>x</li></ul>" },
      ],
      count: 2,
    });
  });

  it("gives a body without h2 no chapters, and a body that starts with one no intro", () => {
    expect(skinChapters("<p>Only text.</p>")).toEqual({ intro: "<p>Only text.</p>", chapters: [], count: 0 });
    expect(skinChapters("<h2>A</h2><p>a</p>").intro).toBe("");
    expect(skinChapters(undefined)).toEqual({ intro: "", chapters: [], count: 0 });
  });

  it("keeps an h3 inside its chapter", () => {
    expect(skinChapters("<h2>A</h2><h3>a.1</h3><p>x</p>").chapters).toEqual([{ number: "01", title: "A", html: "<h3>a.1</h3><p>x</p>" }]);
  });
});

describe("skinSections", () => {
  it("numbers the top-level entries from 01, leaving out the home page, and marks the one a page is in", () => {
    expect(skinSections(nav("/guides/setup/")).map(s => [s.number, s.title, s.inSection, s.description ?? null])).toEqual([
      ["01", "Guides", true, "Longer texts."],
      ["02", "About", false, null],
    ]);
    expect(skinSections(nav("/about/")).map(s => s.inSection)).toEqual([false, true]);
    expect(skinSections(nav("/")).map(s => s.inSection)).toEqual([false, false]);
  });
});

describe("skinIndex", () => {
  it("is 00 for the home page, the section's number for a section, number.position for its pages", () => {
    expect(["/", "/guides/", "/guides/setup/", "/about/", "/nowhere/"].map(r => skinIndex(nav(r)))).toEqual(["00", "01", "01.1", "02", "—"]);
  });
});

describe("skinNext", () => {
  it("is the next page in nav order, and the last page wraps to the first", () => {
    expect(["/", "/guides/", "/guides/setup/", "/about/"].map(r => skinNext(nav(r))?.route)).toEqual(["/guides/", "/guides/setup/", "/about/", "/"]);
    expect(skinNext(nav("/about/"))).toEqual({ route: "/", title: "Storefront bench" });
    expect(skinNext(nav("/nowhere/"))).toBeNull();
  });
});

describe("skinTitleEm", () => {
  it("is the width of a title's longest word in the display face, in em, its tracking included", () => {
    // Storefront: its letters' advances (5.626em) and ten letters of -0.06em tracking.
    expect(skinTitleEm("Storefront bench")).toBe(5.026);
    expect(skinTitleEm("About")).toBe(3.042);
    // A letter the table does not have counts as an average one (0.6em).
    expect(skinTitleEm("é")).toBe(0.54);
    expect(skinTitleEm("")).toBe(1);
    expect(skinTitleEm(undefined)).toBe(1);
  });
});

describe("skinMarquee", () => {
  it("scrolls a page's section headings, and on the home page the site's sections", () => {
    const body = "<p>x</p><h2>Pages</h2><p>a</p><h2>Layouts</h2><p>b</p>";
    expect(skinMarquee(body, nav("/guides/setup/"))).toEqual(["Pages", "Layouts"]);
    expect(skinMarquee(body, nav("/"))).toEqual(["Guides", "About"]);
    expect(skinMarquee("<p>No sections.</p>", nav("/about/"))).toEqual([]);
  });
});
