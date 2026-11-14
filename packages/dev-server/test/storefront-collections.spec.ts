// Collections (collections.ts, teaser.ts, pages.ts): what a listing shows of each page, the first-paragraph
// fallback for a page with no description (cached by a hash of the body, so an edit is never answered stale), a
// folder's order or newest-first sort, and where a date comes from: the page's own, else git's created.
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readPages } from "../src/storefront/pages.js";
import { entriesOf } from "../src/storefront/collections.js";
import { firstParagraph, teaserOf, teaserStats } from "../src/storefront/teaser.js";
import type { DatedPage, GitDates } from "../src/storefront/git-dates.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

async function pages(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pd-collections-"));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    const file = join(root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await save(file, body);
  }
  return root;
}
const page = (title: string, extra = "", body = `Body of ${title}.`): string => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;

/** Git dates from a table of page path → created, as createGitDates answers. */
function fakeDates(created: Record<string, string>, o: { shallow?: boolean } = {}): GitDates {
  return {
    async of(path: string, mode: "dev" | "build"): Promise<DatedPage> {
      const c = created[path] ?? null;
      const problems = o.shallow && mode === "build" ? [`${path}: the repository is a shallow clone`] : [];
      return { dates: { created: c, modified: c }, notes: c === null ? [`${path}: not committed yet, so it has no dates`] : [], problems, shallow: !!o.shallow };
    },
    statusChanged() { /* nothing to forget */ },
  };
}

describe("firstParagraph", () => {
  it("is the first paragraph's text, without markup, whitespace collapsed", () => {
    expect(firstParagraph("# Heading\n\nSome *emphasis*, a [link](/x/) and `code`,\nover   two lines.\n\nSecond.")).toBe(
      "Some emphasis, a link and code, over two lines.");
  });

  it("skips a paragraph that is only an image, or only a placed component, and keeps the text around a pd- tag", () => {
    expect(firstParagraph("![A photo](/assets/images/a.png)\n\n<pd-components-card title=\"x\"></pd-components-card>\n\nThe text.")).toBe("The text.");
    expect(firstParagraph("Before <pd-components-badge>inside</pd-components-badge> after.")).toBe("Before after.");
  });

  it("decodes entities, and is null for a body with no paragraph of text", () => {
    expect(firstParagraph("Fish &amp; chips")).toBe("Fish & chips");
    expect(firstParagraph("## Only a heading\n\n```\ncode\n```\n")).toBeNull();
    expect(firstParagraph("")).toBeNull();
  });

  it("is never shortened", () => {
    const long = "word ".repeat(400).trim();
    expect(firstParagraph(long)).toBe(long);
  });
});

describe("teaserOf: cached by the body's hash", () => {
  it("parses a body once, and an edited body again", () => {
    const body = `A body seen first in this test ${Math.random()}.`;
    const before = teaserStats.parses;
    expect(teaserOf(body)).toBe(body);
    expect(teaserOf(body)).toBe(body);
    expect(teaserStats.parses - before).toBe(1);
    expect(teaserOf(`${body} Edited.`)).toBe(`${body} Edited.`);
    expect(teaserStats.parses - before).toBe(2);
  });
});

describe("readPages: what a listing shows of each page", () => {
  it("reads description, date, image, tags and draft, and falls back to the first paragraph", async () => {
    const root = await pages({
      "index.md": page("Home"),
      "articles/index.md": page("Articles", "sort: date\n"),
      "articles/one.md": page("One", "description: Its own\ndate: 2026-11-02\nimage: /assets/images/one.png\ntags: [css, html]\ndraft: true\n"),
      "articles/two.md": page("Two", "", "![x](/assets/a.png)\n\nThe *first* words."),
      "articles/bad.md": page("Bad", "date: 2026-02-30\ntags: [Nope]\nimage: one.png\ndraft: maybe\n"),
    });
    const model = await readPages(root);
    expect(model.entries.get("/articles/one/")).toEqual({ description: "Its own", date: "2026-11-02", image: "/assets/images/one.png", tags: ["css", "html"], draft: true });
    expect(model.entries.get("/articles/two/")).toEqual({ description: "The first words.", date: null, image: null, tags: [], draft: false });
    // A value that fails its check is left out; the page's own check reports it.
    expect(model.entries.get("/articles/bad/")).toEqual({ description: "Body of Bad.", date: null, image: null, tags: [], draft: false });
    expect(model.folders.get("/articles/")).toEqual({ sort: "date", children: ["/articles/bad/", "/articles/one/", "/articles/two/"] });
  });

  it("lists a folder's direct pages and its subfolders by their index.md, in the folder's order", async () => {
    const root = await pages({
      "index.md": page("Home"),
      "docs/index.md": page("Docs", "order: [zeta, guides, ...]\n"),
      "docs/alpha.md": page("Alpha"),
      "docs/zeta.md": page("Zeta"),
      "docs/guides/index.md": page("Guides"),
      "docs/guides/deep.md": page("Deep"),
    });
    const model = await readPages(root);
    expect(model.folders.get("/docs/")).toEqual({ sort: "order", children: ["/docs/zeta/", "/docs/guides/", "/docs/alpha/"] });
    expect(model.folders.get("/docs/guides/")?.children).toEqual(["/docs/guides/deep/"]);
    expect(model.folders.get("/")?.children).toEqual(["/docs/"]);
  });
});

describe("entriesOf", () => {
  const site = {
    "index.md": page("Home"),
    "articles/index.md": page("Articles", "sort: date\n"),
    "articles/a.md": page("A", "date: 2026-10-01\n"),
    "articles/b.md": page("B", "date: 2026-11-02\n"),
    "articles/c.md": page("C", "date: 2026-10-01\n"),
    "articles/d.md": page("D"),
  };

  it("sorts newest first, ties by route, and takes git's created day where a page has no date", async () => {
    const model = await readPages(await pages(site));
    const r = await entriesOf("/articles/", model, { dates: fakeDates({ "articles/d.md": "2026-10-15T09:00:00+02:00" }), mode: "build" });
    expect(r.problems).toEqual([]);
    expect(r.entries.map(e => [e.route, e.date])).toEqual([
      ["/articles/b/", "2026-11-02"], ["/articles/d/", "2026-10-15"], ["/articles/a/", "2026-10-01"], ["/articles/c/", "2026-10-01"]]);
    expect(r.entries[0]).toEqual({ route: "/articles/b/", title: "B", description: "Body of B.", date: "2026-11-02", image: null, tags: [], draft: false });
  });

  it("keeps the folder's order without sort: date", async () => {
    const model = await readPages(await pages({ ...site, "articles/index.md": page("Articles") }));
    const r = await entriesOf("/articles/", model, { mode: "build" });
    expect(r.entries.map(e => e.route)).toEqual(["/articles/a/", "/articles/b/", "/articles/c/", "/articles/d/"]);
    expect(r.entries.find(e => e.route === "/articles/d/")?.date).toBeNull();
    expect(r.problems).toEqual([]);
  });

  it("a page with no date at all: a problem in pd build, a note in pd dev, where it is listed last", async () => {
    const model = await readPages(await pages(site));
    const text = "articles/index.md: sort: date, but articles/d.md has no date: give it one (date: YYYY-MM-DD), or commit it so git dates it";
    const built = await entriesOf("/articles/", model, { dates: fakeDates({}), mode: "build" });
    expect(built.problems).toEqual([text]);
    const dev = await entriesOf("/articles/", model, { dates: fakeDates({}), mode: "dev" });
    expect(dev.problems).toEqual([]);
    expect(dev.notes).toEqual(["articles/d.md: not committed yet, so it has no dates", `${text}; it is listed last`]);
    expect(dev.entries.at(-1)?.route).toBe("/articles/d/");
  });

  it("refuses, in pd build, a date that would come from a shallow clone; a page's own date needs no git", async () => {
    const model = await readPages(await pages(site));
    const r = await entriesOf("/articles/", model, { dates: fakeDates({ "articles/d.md": "2026-10-15T09:00:00Z" }, { shallow: true }), mode: "build" });
    expect(r.problems).toContain("articles/d.md: the repository is a shallow clone");
    expect(r.problems.filter(p => p.includes("shallow"))).toHaveLength(1);
  });

  it("is empty for a route that is not a folder", async () => {
    const model = await readPages(await pages(site));
    expect((await entriesOf("/articles/a/", model, { mode: "build" })).entries).toEqual([]);
  });
});
