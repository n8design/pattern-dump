// The storefront's page model: routes from file paths, the nav from folders and `order` (the component
// tree's rules, inherited), and every problem that keeps a pages folder from being a sound site.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { readPages, routeFor } from "../src/storefront/pages.js";
import { checkPageFrontmatter } from "../src/storefront/frontmatter-contract.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

/** A pages folder from { "path": "contents" }. A page body defaults to a title-only frontmatter. */
async function pages(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pd-pages-"));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    const file = join(root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await save(file, body);
  }
  return root;
}
// A layout schema requiring a title, for the end-to-end check below.
let schemaFile = "";
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "pd-pages-schema-"));
  roots.push(dir);
  schemaFile = join(dir, "page.schema.json");
  await save(schemaFile, JSON.stringify({ required: ["title"], properties: { title: { type: "string" }, description: { type: "string" } } }));
});

const page = (title: string, extra = ""): string => `---\ntitle: ${title}\n${extra}---\n\nBody of ${title}.\n`;
const navRoutes = (nav: Awaited<ReturnType<typeof readPages>>["nav"]) =>
  nav.map(n => n.children ? `${n.route} [${n.children.map(c => c.route).join(" ")}]` : n.route);

describe("routeFor", () => {
  it("maps a file to the route its path names", () => {
    expect(routeFor("index.md")).toBe("/");
    expect(routeFor("about.md")).toBe("/about/");
    expect(routeFor("guides/index.md")).toBe("/guides/");
    expect(routeFor("guides/setup.md")).toBe("/guides/setup/");
    expect(routeFor("a/b/c.md")).toBe("/a/b/c/");
  });
});

describe("readPages — the storefront bench", () => {
  it("reads its pages, their titles and layouts, and its nav, with no problems", async () => {
    const bench = fileURLToPath(new URL("../../../storefront-bench/pages/", import.meta.url));
    const model = await readPages(bench);
    expect(model.problems).toEqual([]);
    expect(model.pages).toEqual([
      { route: "/", title: "Storefront bench", layout: "home" },
      { route: "/guides/", title: "Guides", layout: "page" },
      { route: "/guides/setup/", title: "Setup", layout: "doc", redirectFrom: ["/setup/", "/start/"] },
      { route: "/about/", title: "About", layout: "doc" },
      { route: "/articles/", title: "Articles", layout: "listing" },
      { route: "/articles/harbour/", title: "A harbour of cable cars", layout: "article" },
      { route: "/articles/plain/", title: "Plain on purpose", layout: "doc" },
    ]);
    expect(model.nav).toEqual([
      { route: "/", title: "Storefront bench", description: "A small website rendered from markdown, with the bench's own skin." },
      { route: "/guides/", title: "Guides", description: "Longer texts about the bench.",
        children: [{ route: "/guides/setup/", title: "Setup", description: "How the bench is put together." }] },
      { route: "/about/", title: "About", description: "What the bench is for." },
      { route: "/articles/", title: "Articles", description: "Everything written for the bench, newest first.", children: [
        { route: "/articles/harbour/", title: "A harbour of cable cars" },
        { route: "/articles/plain/", title: "Plain on purpose", description: "Why the bench's skin is a wireframe." },
      ] },
    ]);
    expect([...model.files.keys()]).toEqual(["/", "/guides/", "/guides/setup/", "/about/", "/articles/", "/articles/harbour/", "/articles/plain/"]);
    expect(model.files.get("/guides/setup/")?.path).toBe("guides/setup.md");
  });
});

describe("readPages — order, as in the component tree", () => {
  it("without any order, sorts by name, numbers numerically", async () => {
    const root = await pages({ "index.md": page("Home"), "b.md": page("B"), "a.md": page("A"), "item10.md": page("10"), "item2.md": page("2") });
    // Home is a top-level item like any other: with no number it sorts by its name, "index".
    expect(navRoutes((await readPages(root)).nav)).toEqual(["/a/", "/b/", "/", "/item2/", "/item10/"]);
  });

  it("ranks a page and a folder by their own number", async () => {
    const root = await pages({
      "index.md": page("Home", "order: -10\n"), "a.md": page("A", "order: 5\n"), "b.md": page("B"),
      "g/index.md": page("G", "order: 1\n"), "g/x.md": page("X"),
    });
    expect(navRoutes((await readPages(root)).nav)).toEqual(["/", "/b/", "/g/ [/g/x/]", "/a/"]);
  });

  it("orders a folder's pages by the list in its index.md, with ... for the rest", async () => {
    const root = await pages({
      "index.md": page("Home"),
      "g/index.md": page("G", "order: [zeta, ..., alpha]\n"),
      "g/alpha.md": page("Alpha"), "g/beta.md": page("Beta"), "g/gamma.md": page("Gamma"), "g/zeta.md": page("Zeta"),
    });
    expect(navRoutes((await readPages(root)).nav)).toEqual(["/g/ [/g/zeta/ /g/beta/ /g/gamma/ /g/alpha/]", "/"]);
  });

  it("lets a number win over the parent's list", async () => {
    const root = await pages({
      "index.md": page("Home"),
      "g/index.md": page("G", "order: [b, a]\n"), "g/a.md": page("A", "order: -1\n"), "g/b.md": page("B"),
    });
    expect(navRoutes((await readPages(root)).nav)).toEqual(["/g/ [/g/a/ /g/b/]", "/"]);
  });

  describe("the root index.md is both Home and the root folder's index", () => {
    it("its number ranks Home among the top-level items", async () => {
      // Without its number Home would rank 0 and sort before z by name; with it, it comes after z.
      const root = await pages({ "index.md": page("Home", "order: 5\n"), "z.md": page("Z"), "b.md": page("B", "order: 9\n") });
      expect(navRoutes((await readPages(root)).nav)).toEqual(["/z/", "/", "/b/"]);
    });

    it("its list orders the top level; Home is the name index in it", async () => {
      const root = await pages({ "index.md": page("Home", "order: [b, index, a]\n"), "a.md": page("A"), "b.md": page("B") });
      expect(navRoutes((await readPages(root)).nav)).toEqual(["/b/", "/", "/a/"]);
    });

    it("a list that leaves Home out puts it with the rest", async () => {
      const root = await pages({ "index.md": page("Home", "order: [b, a]\n"), "a.md": page("A"), "b.md": page("B"), "c.md": page("C") });
      expect(navRoutes((await readPages(root)).nav)).toEqual(["/b/", "/a/", "/c/", "/"]);
    });
  });
});

describe("readPages — what the nav shows", () => {
  it("adding a markdown file adds a page and a nav entry, and changes nothing else", async () => {
    const files = { "index.md": page("Home", "order: 0\n"), "about.md": page("About", "order: 2\n"), "g/index.md": page("G", "order: 1\n"), "g/x.md": page("X") };
    const before = await readPages(await pages(files));
    const after = await readPages(await pages({ ...files, "g/y.md": page("Y"), "contact.md": page("Contact", "order: 3\n") }));
    expect(after.problems).toEqual([]);
    expect(after.pages.map(p => p.route)).toEqual([...before.pages.map(p => p.route).slice(0, 3), "/g/y/", "/about/", "/contact/"]);
    expect(after.nav).toEqual([
      before.nav[0],
      { ...before.nav[1], children: [...before.nav[1].children!, { route: "/g/y/", title: "Y" }] },
      before.nav[2],
      { route: "/contact/", title: "Contact" },
    ]);
  });

  it("carries each page's description, a top-level entry's and a folder page's, and none where a page has none", async () => {
    const model = await readPages(await pages({
      "index.md": page("Home", "description: The front page.\n"),
      "g/index.md": page("G"),
      "g/x.md": page("X", "description: A page in G.\n"),
    }));
    // Without an order, entries sort by name: g before the home page's index.
    expect(model.nav).toEqual([
      { route: "/g/", title: "G", children: [{ route: "/g/x/", title: "X", description: "A page in G." }] },
      { route: "/", title: "Home", description: "The front page." },
    ]);
    expect("description" in model.nav[0]).toBe(false);
  });

  it("is one level deep: deeper pages exist at their routes, but not in the nav", async () => {
    const root = await pages({
      "index.md": page("Home"), "a/index.md": page("A"), "a/b/index.md": page("B"), "a/b/deep.md": page("Deep"),
    });
    const model = await readPages(root);
    expect(model.problems).toEqual([]);
    expect(model.nav).toEqual([
      { route: "/a/", title: "A", children: [{ route: "/a/b/", title: "B" }] },
      { route: "/", title: "Home" },
    ]);
    expect(model.pages.map(p => p.route)).toEqual(["/a/", "/a/b/", "/", "/a/b/deep/"]);
  });

  it("falls back to the route for the label only: the page's frontmatter values keep no title", async () => {
    // Step 8 validates the values against the layout's schema; a missing required title must still be
    // missing there, so the fallback lives in the page entry and the nav, never in the values.
    const model = await readPages(await pages({ "index.md": page("Home"), "untitled.md": "---\ndescription: No title here\n---\n" }));
    expect(model.files.get("/untitled/")?.frontmatter.values).toEqual({ description: "No title here" });
    expect("title" in model.files.get("/untitled/")!.frontmatter.values).toBe(false);
    expect(model.pages.find(p => p.route === "/untitled/")?.title).toBe("/untitled/");
    expect(model.nav.find(n => n.route === "/untitled/")?.title).toBe("/untitled/");
  });

  it("a page without a title reaches the frontmatter check without one, so a required title is reported missing", async () => {
    const root = await pages({ "index.md": "---\ndescription: No title\n---\n" });
    const model = await readPages(root);
    const map = new Map([["layouts/page", { hbsPath: "/x/page.hbs", schemaPath: schemaFile, ownMarkup: true }]]) as DiscoveryMap;
    const checked = await checkPageFrontmatter(model.files.get("/")!, map);
    expect(checked.problems).toEqual([{ file: "index.md", message: `"title" is required by layout "page"` }]);
    expect(model.nav[0].title).toBe("/");
  });

  it("titles a page by its route when it has no title, and gives it the page layout when it names none", async () => {
    const model = await readPages(await pages({ "index.md": "No frontmatter.\n", "x.md": "---\nlayout: article\n---\n" }));
    expect(model.pages).toEqual([{ route: "/", title: "/", layout: "page" }, { route: "/x/", title: "/x/", layout: "article" }]);
  });
});

describe("readPages — problems (each one fatal to the caller)", () => {
  it("a folder of pages with no index.md", async () => {
    const model = await readPages(await pages({ "index.md": page("Home"), "guides/setup.md": page("Setup") }));
    expect(model.problems).toEqual(["the folder guides/ holds pages but has no index.md — it needs one, as the folder's own page"]);
    expect(model.nav.map(n => n.route)).toEqual(["/"]);
  });

  it("two files that are the same page", async () => {
    const model = await readPages(await pages({ "index.md": page("Home"), "about.md": page("About"), "about/index.md": page("About too") }));
    expect(model.problems).toEqual(["about.md and about/index.md are both the page at /about/"]);
  });

  it("a page file name that cannot be part of a URL", async () => {
    const model = await readPages(await pages({ "index.md": page("Home"), "Setup.md": page("S"), "my_page.md": page("M"), "café.md": page("C") }));
    expect(model.problems).toEqual([
      "Setup.md: a page's file name is part of the URL, so it is lowercase letters, digits and hyphens only, then .md",
      "café.md: a page's file name is part of the URL, so it is lowercase letters, digits and hyphens only, then .md",
      "my_page.md: a page's file name is part of the URL, so it is lowercase letters, digits and hyphens only, then .md",
    ]);
    expect(model.pages.map(p => p.route)).toEqual(["/"]);
  });

  it("a folder name that cannot be part of a URL, whose files are then not read", async () => {
    const model = await readPages(await pages({ "index.md": page("Home"), "My Guides/index.md": page("G"), "My Guides/x.md": page("X") }));
    expect(model.problems).toEqual(["My Guides/: a folder name is part of the URL, so it is lowercase letters, digits and hyphens only"]);
    expect(model.pages.map(p => p.route)).toEqual(["/"]);
  });

  it("a file that is not a page", async () => {
    const model = await readPages(await pages({ "index.md": page("Home"), "logo.png": "png", "guides/index.md": page("G"), "guides/notes.txt": "x" }));
    expect(model.problems).toEqual([
      "guides/notes.txt is not a page: only .md files belong in the pages folder (images and other files go in the project's assets)",
      "logo.png is not a page: only .md files belong in the pages folder (images and other files go in the project's assets)",
    ]);
  });

  it("ignores dotfiles and dot-folders", async () => {
    const model = await readPages(await pages({ "index.md": page("Home"), ".DS_Store": "x", ".drafts/secret.md": page("Secret"), "g/index.md": page("G"), "g/.notes": "x" }));
    expect(model.problems).toEqual([]);
    expect(model.pages.map(p => p.route)).toEqual(["/g/", "/"]);
  });

  it("an empty pages folder has no home page", async () => {
    const model = await readPages(await pages({}));
    expect(model).toEqual({
      pages: [], nav: [], files: new Map(), entries: new Map(), folders: new Map(), drafts: [],
      problems: ["there is no home page: the pages folder needs an index.md at its top, the page at /"],
    });
  });

  it("pages without an index.md at the top have no home page", async () => {
    const model = await readPages(await pages({ "about.md": page("About") }));
    expect(model.problems).toEqual(["there is no home page: the pages folder needs an index.md at its top, the page at /"]);
    expect(model.pages.map(p => p.route)).toEqual(["/about/"]);
  });

  it("a pages folder that does not exist", async () => {
    const missing = join(await pages({}), "no-such-folder");
    expect(await readPages(missing)).toEqual({ pages: [], nav: [], files: new Map(), entries: new Map(), folders: new Map(), drafts: [], problems: [`the pages folder ${missing} does not exist`] });
  });

  it("a pages path that is a file, not a folder", async () => {
    const file = join(await pages({ "index.md": page("Home") }), "index.md");
    expect((await readPages(file)).problems).toEqual([`the pages folder ${file} does not exist`]);
  });
});

describe("readPages — the path of a workbench published on the same host", () => {
  const home = page("Home");
  it("refuses a page at the workbench's path, and one under it", async () => {
    const dir = await pages({ "index.md": home, "workbench/index.md": page("Workbench"), "workbench/notes.md": page("Notes") });
    expect((await readPages(dir, { workbenchPath: "/workbench/" })).problems).toEqual([
      `workbench/index.md: the page /workbench/ is at /workbench/, where the workbench is published on this host (storefront.workbenchUrl), so the workbench would overwrite it there`,
      `workbench/notes.md: the page /workbench/notes/ is under /workbench/, where the workbench is published on this host (storefront.workbenchUrl), so the workbench would overwrite it there`,
    ]);
  });

  it("takes the path as whole segments: a page whose route only starts with the same letters is fine", async () => {
    const dir = await pages({ "index.md": home, "workbench-notes.md": page("Notes"), "work.md": page("Work") });
    expect((await readPages(dir, { workbenchPath: "/workbench/" })).problems).toEqual([]);
  });

  it("checks nothing for a workbench on a host of its own", async () => {
    const dir = await pages({ "index.md": home, "workbench.md": page("Workbench") });
    expect((await readPages(dir)).problems).toEqual([]);
  });
});
