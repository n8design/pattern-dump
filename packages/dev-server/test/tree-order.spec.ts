// Tree order and folder overviews.
//
// Nothing pinned either before: no test asserted sibling order, and none asserted when a folder gets
// an overview. Both are now contract rules (TreeNode.hasOverview, ComponentTree), so they are pinned
// here on throwaway fixtures — test-bench's own order is a demo corpus, not a specification.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TreeNode } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { buildComponentTree, folderTitle } from "../src/component-tree.js";
import { buildFolderOverview } from "../src/overview.js";
import { readFrontmatter } from "../src/frontmatter.js";
import { orderSiblings, parseOrder, REST } from "../src/tree-order.js";

// ─── frontmatter ─────────────────────────────────────────────────────────────

describe("readFrontmatter", () => {
  it("reads scalars, inline lists and block lists from the leading block only", () => {
    const fm = readFrontmatter([
      "---",
      "title: \"Buttons, mostly\"",
      "order: [button, 'badge' , chip]",
      "tags:",
      "  - a",
      "  - b",
      "weight: 3",
      "---",
      "order: body-line-is-not-metadata",
    ].join("\n"));
    expect(fm).toEqual({ title: "Buttons, mostly", order: ["button", "badge", "chip"], tags: ["a", "b"], weight: "3" });
  });

  it("returns nothing for a file without a leading block, or an unterminated one", () => {
    expect(readFrontmatter("order: 1\n")).toEqual({});
    expect(readFrontmatter("\n---\norder: 1\n---\n")).toEqual({});
    expect(readFrontmatter("---\norder: 1\n")).toEqual({});
  });

  it("accepts CRLF line endings", () => {
    expect(readFrontmatter("---\r\norder: 2\r\n---\r\n")).toEqual({ order: "2" });
  });
});

describe("parseOrder", () => {
  it("a number is a weight; a list or comma string is a list", () => {
    expect(parseOrder("10")).toEqual({ weight: 10 });
    expect(parseOrder("-1.5")).toEqual({ weight: -1.5 });
    expect(parseOrder(["b", "a"])).toEqual({ list: ["b", "a"] });
    expect(parseOrder("b, a")).toEqual({ list: ["b", "a"] });
    expect(parseOrder(undefined)).toBeUndefined();
  });

  it("reads the rest marker in both list spellings", () => {
    expect(parseOrder(readFrontmatter("---\norder: [atoms, ..., pages]\n---\n")["order"])).toEqual({ list: ["atoms", REST, "pages"] });
    expect(parseOrder(readFrontmatter("---\norder:\n  - ...\n  - pages\n---\n")["order"])).toEqual({ list: [REST, "pages"] });
  });
});

describe("orderSiblings", () => {
  const seg = (...names: string[]) => names.map(segment => ({ segment }));
  const names = (xs: Array<{ segment: string }>) => xs.map(x => x.segment);

  it("is alphabetical and numeric-aware by default", () => {
    expect(names(orderSiblings(seg("item10", "b", "item2", "a")))).toEqual(["a", "b", "item2", "item10"]);
  });

  it("a missing number is rank 0: negative ranks come first, positive ranks last", () => {
    const items = [{ segment: "a" }, { segment: "b", weight: 10 }, { segment: "c", weight: -1 }, { segment: "d", weight: 2 }];
    expect(names(orderSiblings(items))).toEqual(["c", "a", "d", "b"]);
  });

  it("equal ranks follow the list, then ..., then the alphabet", () => {
    const items = [
      { segment: "pages" }, { segment: "zeta" }, { segment: "atoms" }, { segment: "alpha" }, { segment: "molecules" },
    ];
    expect(names(orderSiblings(items, ["atoms", "molecules", REST, "pages"])))
      .toEqual(["atoms", "molecules", "alpha", "zeta", "pages"]);
    expect(names(orderSiblings(items, ["pages", "nope", "atoms"])))
      .toEqual(["pages", "atoms", "alpha", "molecules", "zeta"]);
  });

  it("a number beats the list: -100 goes first and 100 last, whatever the list says", () => {
    const items = [
      { segment: "atoms" }, { segment: "molecules" }, { segment: "pages" },
      { segment: "first", weight: -100 }, { segment: "last", weight: 100 }, { segment: "atoms-too", weight: 0 },
    ];
    expect(names(orderSiblings(items, ["last", "atoms", "molecules", REST, "pages", "first"])))
      .toEqual(["first", "atoms", "molecules", "atoms-too", "pages", "last"]);
  });

  it("... first puts the unnamed rank-0 children ahead of the listed ones", () => {
    const items = [{ segment: "atoms" }, { segment: "projects" }, { segment: "b" }];
    expect(names(orderSiblings(items, [REST, "atoms"]))).toEqual(["b", "projects", "atoms"]);
  });
});

// ─── tree + overview on a fixture corpus ─────────────────────────────────────

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

async function corpus(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pd-tree-order-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }
  return root;
}

async function tree(patterns: string, overviews = true) {
  const { discoveryMap } = await buildDiscoveryMap(patterns);
  return { tree: await buildComponentTree(patterns, overviews, discoveryMap), discoveryMap };
}

const find = (nodes: TreeNode[], path: string): TreeNode | undefined => {
  for (const n of nodes) {
    if (n.path === path) return n;
    const hit = n.children && find(n.children, path);
    if (hit) return hit;
  }
  return undefined;
};

const hbs = "<p>x</p>\n";

describe("buildComponentTree — order", () => {
  it("roots and children are alphabetical with no overrides", async () => {
    const p = await corpus({
      "molecules/zeta/zeta.hbs": hbs, "atoms/b/b.hbs": hbs, "atoms/a/a.hbs": hbs,
    });
    const { tree: t } = await tree(p);
    expect(t.roots.map(r => r.path)).toEqual(["atoms", "molecules"]);
    expect(find(t.roots, "atoms")!.children!.map(c => c.path)).toEqual(["atoms/a", "atoms/b"]);
  });

  it("patterns/index.md orders the roots", async () => {
    const p = await corpus({
      "index.md": "---\norder: [molecules, atoms]\n---\n",
      "atoms/a/a.hbs": hbs, "molecules/m/m.hbs": hbs,
    });
    expect((await tree(p)).tree.roots.map(r => r.path)).toEqual(["molecules", "atoms"]);
  });

  it("component .md weights order siblings", async () => {
    const p = await corpus({
      "atoms/a/a.hbs": hbs,
      "atoms/b/b.hbs": hbs, "atoms/b/b.md": "---\norder: 2\n---\n",
      "atoms/c/c.hbs": hbs, "atoms/c/c.md": "---\norder: 1\n---\n",
    });
    expect(find((await tree(p)).tree.roots, "atoms")!.children!.map(c => c.path))
      .toEqual(["atoms/a", "atoms/c", "atoms/b"]);
  });

  it("children's numbers beat the folder index.md list; the list orders equal ranks", async () => {
    const p = await corpus({
      "atoms/index.md": "---\norder:\n  - a\n  - b\n---\n",
      "atoms/a/a.hbs": hbs, "atoms/a/a.md": "---\norder: 9\n---\n",
      "atoms/b/b.hbs": hbs, "atoms/b/b.md": "---\norder: 1\n---\n",
      "atoms/c/c.hbs": hbs, "atoms/c/c.md": "---\norder: 0\n---\n",
      "atoms/d/d.hbs": hbs,
    });
    expect(find((await tree(p)).tree.roots, "atoms")!.children!.map(c => c.path))
      .toEqual(["atoms/c", "atoms/d", "atoms/b", "atoms/a"]);
  });

  it("a group folder's own index.md number orders it among its siblings", async () => {
    const p = await corpus({
      "atoms/zz-group/index.md": "---\norder: -1\n---\n",
      "atoms/zz-group/inner/inner.hbs": hbs,
      "atoms/aa/aa.hbs": hbs,
    });
    expect(find((await tree(p)).tree.roots, "atoms")!.children!.map(c => c.path))
      .toEqual(["atoms/zz-group", "atoms/aa"]);
  });

  it("a positive number sends a folder past every rank-0 sibling, its parent's list included", async () => {
    const p = await corpus({
      "index.md": "---\norder: [atoms, molecules, ..., pages]\n---\n",
      "atoms/a/a.hbs": hbs, "molecules/m/m.hbs": hbs, "pages/p/p.hbs": hbs,
      "projects/index.md": "---\ntitle: Our fancy projects\norder: 1\n---\n", "projects/cool-stuff.hbs": hbs,
      "extras/e/e.hbs": hbs,
    });
    const r = await tree(p);
    expect(r.tree.roots.map(n => n.path)).toEqual(["atoms", "molecules", "extras", "pages", "projects"]);
  });

  it("the same folder with order: -5 goes first; with none it takes the ... position", async () => {
    const files = {
      "index.md": "---\norder: [atoms, molecules, ..., pages]\n---\n",
      "atoms/a/a.hbs": hbs, "molecules/m/m.hbs": hbs, "pages/p/p.hbs": hbs, "projects/cool-stuff.hbs": hbs,
    };
    const first = await corpus({ ...files, "projects/index.md": "---\ntitle: Our fancy projects\norder: -5\n---\n" });
    expect((await tree(first)).tree.roots.map(n => n.path)).toEqual(["projects", "atoms", "molecules", "pages"]);
    await rm(first, { recursive: true, force: true });
    const rest = await corpus(files);
    expect((await tree(rest)).tree.roots.map(n => n.path)).toEqual(["atoms", "molecules", "projects", "pages"]);
  });

  it("an order key in the doc BODY is not read", async () => {
    const p = await corpus({
      "atoms/a/a.hbs": hbs,
      "atoms/b/b.hbs": hbs, "atoms/b/b.md": "---\ntitle: B\n---\n\norder: 1\n",
    });
    expect(find((await tree(p)).tree.roots, "atoms")!.children!.map(c => c.path))
      .toEqual(["atoms/a", "atoms/b"]);
  });
});

describe("buildComponentTree — hasOverview", () => {
  it("a group gets an overview without an index.md when it holds a public component", async () => {
    const p = await corpus({ "organisms/card/card.hbs": hbs, "atoms/grp/inner/inner.hbs": hbs });
    const { tree: t } = await tree(p);
    expect(find(t.roots, "organisms")!.hasOverview).toBe(true);
    expect(find(t.roots, "atoms/grp")!.hasOverview).toBe(true);
  });

  it("a group holding only private components gets none", async () => {
    const p = await corpus({
      "atoms/secret/secret.hbs": hbs,
      "atoms/secret/secret.md": "---\nvisibility: private\n---\n",
    });
    expect(find((await tree(p)).tree.roots, "atoms")!.hasOverview).toBe(false);
  });

  it("overview: false in index.md opts a folder out; the global switch opts all out", async () => {
    const p = await corpus({
      "atoms/index.md": "---\noverview: false\n---\n",
      "atoms/a/a.hbs": hbs, "molecules/m/m.hbs": hbs,
    });
    const on = (await tree(p)).tree.roots;
    expect(find(on, "atoms")!.hasOverview).toBe(false);
    expect(find(on, "molecules")!.hasOverview).toBe(true);
    expect((await tree(p, false)).tree.roots.every(r => !r.hasOverview)).toBe(true);
  });

  it("component nodes never get a folder overview", async () => {
    const p = await corpus({ "molecules/field/field.hbs": hbs, "molecules/field/input/input.hbs": hbs });
    expect(find((await tree(p)).tree.roots, "molecules/field")!.hasOverview).toBe(false);
  });
});

describe("buildComponentTree — folder titles", () => {
  it("folderTitle makes a segment readable", () => {
    expect(folderTitle("organisms")).toBe("Organisms");
    expect(folderTitle("quick-links")).toBe("Quick links");
    expect(folderTitle("form_fields")).toBe("Form fields");
    expect(folderTitle("2-col")).toBe("2 col");
  });

  it("a folder without an index.md title gets the readable title; components keep their name", async () => {
    const p = await corpus({ "organisms/quick-links/card/card.hbs": hbs });
    const roots = (await tree(p)).tree.roots;
    expect(find(roots, "organisms")!.title).toBe("Organisms");
    expect(find(roots, "organisms/quick-links")!.title).toBe("Quick links");
    expect(find(roots, "organisms/quick-links/card")!.title).toBe("card");
  });

  it("an explicit index.md title is used verbatim, even when it matches the folder name", async () => {
    const p = await corpus({
      "atoms/index.md": "---\ntitle: atoms\n---\n",
      "atoms/a/a.hbs": hbs,
    });
    expect(find((await tree(p)).tree.roots, "atoms")!.title).toBe("atoms");
  });
});

describe("buildFolderOverview — follows the tree", () => {
  it("lists public components in tree order, skipping private ones", async () => {
    const p = await corpus({
      "atoms/index.md": "---\norder: [zeta, grp]\n---\n",
      "atoms/alpha/alpha.hbs": hbs,
      "atoms/zeta/zeta.hbs": hbs,
      "atoms/grp/two/two.hbs": hbs,
      "atoms/grp/one/one.hbs": hbs,
      "atoms/hidden/hidden.hbs": hbs, "atoms/hidden/hidden.md": "---\nvisibility: private\n---\n",
    });
    const { discoveryMap } = await buildDiscoveryMap(p);
    const render = async () => ({ html: "" });
    const ov = await buildFolderOverview("atoms", p, render, discoveryMap);
    expect(ov.components.map(c => c.id)).toEqual(["atoms/zeta", "atoms/grp/one", "atoms/grp/two", "atoms/alpha"]);
  });

  it("a folder with nothing discovered under it has an empty gallery", async () => {
    const p = await corpus({ "atoms/a/a.hbs": hbs });
    const { discoveryMap } = await buildDiscoveryMap(p);
    const ov = await buildFolderOverview("nowhere", p, async () => ({ html: "" }), discoveryMap);
    expect(ov.components).toEqual([]);
  });
});
