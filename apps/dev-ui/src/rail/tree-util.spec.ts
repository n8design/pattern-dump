// Unit tests for the pure tree helpers. Node environment — nothing here touches the DOM.
//
// buildNodeHtml is the shell's only untrusted-content interpolation site, so the escaping tests are
// the point of this file, not a formality.

import { describe, it, expect } from "vitest";
import type { TreeNode } from "@pattern-dump/contracts";
import { extractFolderPaths, buildSidebarHtml, isEffectivelyPrivate, buildNodeHtml, isEffectivelyPackage, hasPackageComponents } from "./tree-util.js";

const leaf = (path: string, title = path, extra: Partial<TreeNode> = {}): TreeNode =>
  ({ path, title, kind: "component", ...extra }) as TreeNode;
const folder = (path: string, children: TreeNode[], extra: Partial<TreeNode> = {}): TreeNode =>
  ({ path, title: path, kind: "group", children, ...extra }) as TreeNode;

describe("extractFolderPaths", () => {
  it("collects only nodes that have children", () => {
    const tree = [folder("atoms", [leaf("atoms/button")]), leaf("pages/home")];
    expect(extractFolderPaths(tree)).toEqual(new Set(["atoms"]));
  });

  it("recurses into nested folders", () => {
    const tree = [folder("a", [folder("a/b", [leaf("a/b/c")])])];
    expect(extractFolderPaths(tree)).toEqual(new Set(["a", "a/b"]));
  });

  it("treats an empty children array as a leaf, not a folder", () => {
    expect(extractFolderPaths([folder("empty", [])])).toEqual(new Set());
  });
});

describe("isEffectivelyPrivate", () => {
  it("is true for an explicitly private node", () => {
    expect(isEffectivelyPrivate(leaf("x", "x", { visibility: "private" }))).toBe(true);
  });

  it("is true for a group whose every descendant is private — empty-parent hiding", () => {
    const g = folder("g", [
      leaf("g/a", "a", { visibility: "private" }),
      leaf("g/b", "b", { visibility: "private" }),
    ]);
    expect(isEffectivelyPrivate(g)).toBe(true);
  });

  it("is false for a group with even one public descendant", () => {
    const g = folder("g", [leaf("g/a", "a", { visibility: "private" }), leaf("g/b")]);
    expect(isEffectivelyPrivate(g)).toBe(false);
  });

  // A public component that OWNS only private sub-components is itself public. It used to inherit
  // privacy from its children like an empty group does, which hid the owner — and then its whole
  // category, since that category now looked empty. Nesting a private part under its owner is the
  // model the contract describes, so the first project to do it lost the component from the rail.
  it("is false for a public component whose only children are private", () => {
    const owner = leaf("molecules/search-field", "Search field", {
      children: [leaf("molecules/search-field/input", "Input", { visibility: "private" })],
    });
    expect(isEffectivelyPrivate(owner)).toBe(false);
    expect(isEffectivelyPrivate(folder("molecules", [owner]))).toBe(false);
  });
});

describe("isEffectivelyPackage / hasPackageComponents", () => {
  const pkg = (path: string) => leaf(path, path, { source: "@acme/ui" });

  it("marks a package component, and a group made only of package components", () => {
    expect(isEffectivelyPackage(pkg("atoms/button"))).toBe(true);
    expect(isEffectivelyPackage(leaf("atoms/own"))).toBe(false);
    expect(isEffectivelyPackage(folder("organism", [pkg("organism/a"), pkg("organism/b")]))).toBe(true);
  });

  it("keeps a category that mixes project and package components", () => {
    const atoms = folder("atoms", [pkg("atoms/button"), leaf("atoms/own")]);
    expect(isEffectivelyPackage(atoms)).toBe(false);
    const html = buildNodeHtml(atoms, 0);
    expect(html.match(/data-package/g)).toHaveLength(1); // only the package's own node
  });

  it("detects whether the tree has any package component at all", () => {
    expect(hasPackageComponents([folder("atoms", [leaf("atoms/own")])])).toBe(false);
    expect(hasPackageComponents([folder("atoms", [folder("atoms/g", [pkg("atoms/g/x")])])])).toBe(true);
  });
});

describe("buildNodeHtml — escaping of untrusted project content", () => {
  // These are the tests that matter. A component title or path comes from the subject design
  // system, which PD does not control.
  it("escapes angle brackets in a title so markup cannot be injected", () => {
    const html = buildNodeHtml(leaf("atoms/x", "<img src=x onerror=alert(1)>"), 0);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes double quotes in a path so an attribute cannot be broken out of", () => {
    const html = buildNodeHtml(leaf('a" onmouseover="evil()', "t"), 0);

    // NOT `expect(html).not.toMatch(/onmouseover=/)` — that was the first draft and it failed
    // against correct code. The payload text DOES survive, escaped and inert; what matters is that
    // it stays INSIDE the attribute value rather than terminating it. So assert the real invariant:
    // every attribute value is delimited, and none contains a raw quote.
    expect(html).toContain("&quot;");
    for (const [, value] of html.matchAll(/="([^"]*)"/g)) {
      expect(value).not.toContain('"');
    }
    // The payload never becomes a real attribute: no bare ` onmouseover="` outside a value.
    expect(html).not.toMatch(/\son[a-z]+="/);
  });

  it("escapes ampersands without double-escaping the entities it just produced", () => {
    const html = buildNodeHtml(leaf("atoms/x", "Tom & Jerry"), 0);
    expect(html).toContain("Tom &amp; Jerry");
    expect(html).not.toContain("&amp;amp;");
  });

  it("escapes in the folder branch too, not only the leaf branch", () => {
    const html = buildNodeHtml(folder("<bad>", [leaf("<bad>/x", "<script>")], { hasOverview: true }), 0);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<bad>");
    expect(html).toContain("&lt;");
  });
});

describe("buildNodeHtml — structure", () => {
  it("marks a private leaf with data-private and a badge", () => {
    const html = buildNodeHtml(leaf("x", "x", { visibility: "private" }), 0);
    expect(html).toContain("data-private");
    expect(html).toContain("private-badge");
  });

  it("gives a leaf a real href — links navigate, buttons act", () => {
    expect(buildNodeHtml(leaf("atoms/button", "Button"), 0)).toContain('href="/atoms/button"');
  });

  it("emits a show-all link only when the folder has an overview", () => {
    const kids = [leaf("g/a")];
    expect(buildNodeHtml(folder("g", kids, { hasOverview: true }), 0)).toContain("tree-show-all");
    expect(buildNodeHtml(folder("g", kids), 0)).not.toContain("tree-show-all");
  });

  it("[PD-GAP] a component-with-children gets a self-link <li> that carries NO data-path", () => {
    // Pinned: this is the shape behind a tree-search leak, fixed in
    // filterTree by widening its selector. If this ever gains a data-path, that fix can be
    // reconsidered — and this test is where that shows up.
    const html = buildNodeHtml(folder("atoms/base", [leaf("atoms/base/x")], { kind: "component" }), 0);
    expect(html).toContain('<li class="tree-node"><a href="/atoms/base"');
  });

  it("propagates depth to nested nodes", () => {
    const html = buildNodeHtml(folder("g", [leaf("g/a")]), 2);
    expect(html).toContain('data-depth="2"');
  });
});

describe("buildSidebarHtml", () => {
  it("concatenates siblings in order", () => {
    const html = buildSidebarHtml([leaf("a", "Alpha"), leaf("b", "Beta")], 0);
    expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Beta"));
  });

  it("returns an empty string for no nodes", () => {
    expect(buildSidebarHtml([], 0)).toBe("");
  });
});
