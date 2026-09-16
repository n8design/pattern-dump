// Nav Rail — tree search (filterTree, main.ts:1559).
//
// Coverage before this file: none of the behaviour. view-state-store.spec.ts typed "button" only to
// set up a negative assertion that the query does NOT rehydrate, and two region-borders tests focus
// the input to check a border colour. Nothing asserted what the filter hides, what it shows, that
// ancestor folders auto-expand around a match, or that the query survives a tree rebuild.
//
// Characterisation net for the decomposition. filterTree's contract, read off the implementation:
//   - match is case-insensitive, against the link/folder label OR the node's data-path
//   - non-matching .tree-node get [hidden] + [data-hidden-search]
//   - a folder with no visible descendant is itself hidden (it walks details in REVERSE, so the
//     innermost resolves first and emptiness propagates outward)
//   - a folder with a visible descendant is force-opened while a query is active
//   - clearing the query removes [data-hidden-search] and unhides

import { test, expect } from "@playwright/test";

const search = ".sidebar-search input";
const node = (path: string) => `.sidebar-tree .tree-node[data-path="${path}"]`;

async function gotoTree(page: import("@playwright/test").Page) {
  await page.goto("/atoms/button");
  await page.waitForSelector("#preview-frame[srcdoc]");
  await page.waitForSelector(`${node("atoms/button")}`);
}

test.describe("Nav Rail — tree search", () => {
  test("hides non-matching nodes and keeps matching ones visible", async ({ page }) => {
    await gotoTree(page);

    await page.fill(search, "button");

    await expect(page.locator(node("atoms/button"))).not.toHaveAttribute("hidden", /.*/);
    // A component that cannot match "button" must be hidden AND marked, so clearing can undo it.
    const other = page.locator(node("atoms/contrast-fail"));
    await expect(other).toHaveAttribute("hidden", /.*/);
    await expect(other).toHaveAttribute("data-hidden-search", "1");
  });

  test("matches on the path, not only the visible label", async ({ page }) => {
    await gotoTree(page);

    // "molecules/" appears in data-path; it is not the text of any leaf link.
    await page.fill(search, "molecules/");

    await expect(page.locator(node("molecules/field"))).not.toHaveAttribute("hidden", /.*/);
    await expect(page.locator(node("atoms/button"))).toHaveAttribute("hidden", /.*/);
  });

  test("is case-insensitive", async ({ page }) => {
    await gotoTree(page);
    await page.fill(search, "BUTTON");
    await expect(page.locator(node("atoms/button"))).not.toHaveAttribute("hidden", /.*/);
  });

  test("auto-expands the folder containing a match", async ({ page }) => {
    await gotoTree(page);

    // Collapse the atoms folder first, so the open state below is caused by the search.
    const details = page.locator(`${node("atoms")} > .tree-folder-row > details.tree-details`);
    await details.evaluate((d) => { (d as HTMLDetailsElement).open = false; });
    await expect(details).not.toHaveAttribute("open", /.*/);

    await page.fill(search, "button");

    await expect(details).toHaveAttribute("open", "");
    await expect(page.locator(node("atoms"))).not.toHaveAttribute("hidden", /.*/);
  });

  test("a folder with no matching descendant is hidden entirely", async ({ page }) => {
    await gotoTree(page);
    await page.fill(search, "button");

    // molecules contains no "button" match, so the group node itself is hidden -- empty-parent
    // hiding, the reverse walk over details in filterTree.
    await expect(page.locator(node("molecules"))).toHaveAttribute("hidden", /.*/);
  });

  // A query matching nothing hides EVERY node, including the ones with no data-path.
  //
  // This previously asserted the opposite, as a [PD-GAP]. buildNodeHtml (main.ts:1506) emits a
  // self-link entry for a component that also has children -- `<li class="tree-node"><a
  // class="tree-link">…</a></li>` with no data-path -- and filterTree only iterated
  // `.tree-node[data-path]`, so that <li> was never hidden. The folder pass then RESURRECTED its
  // ancestors, because it unhides any folder whose <ul> still holds a non-hidden .tree-node. In
  // test-bench that left three nodes on screen (atoms/baseless-2's self-link, plus atoms/baseless-2
  // and atoms). filterTree now iterates `.tree-node`, and the self-link filters on its label.
  test("a query matching nothing hides every node", async ({ page }) => {
    await gotoTree(page);
    await page.fill(search, "zzzz-no-such-component");

    await expect(page.locator(".sidebar-tree .tree-node:not([hidden])")).toHaveCount(0);
    // Specifically including the data-path-less self-link that used to leak, and the ancestors it
    // used to prop open.
    await expect(page.locator(".sidebar-tree .tree-node:not([data-path]):not([hidden])")).toHaveCount(0);
    await expect(page.locator(`${node("atoms/baseless-2")}:not([hidden])`)).toHaveCount(0);
    await expect(page.locator(`${node("atoms")}:not([hidden])`)).toHaveCount(0);
  });

  // The self-link entry is filtered on its LABEL, since it carries no data-path to match against.
  test("a data-path-less self-link entry still matches its own label", async ({ page }) => {
    await gotoTree(page);
    await page.fill(search, "baseless-2");

    const selfLink = page.locator(".sidebar-tree .tree-node:not([data-path]):not([hidden])");
    await expect(selfLink).toHaveCount(1);
    await expect(selfLink.locator("a.tree-link")).toHaveAttribute("href", "/atoms/baseless-2");
  });

  test("clearing the query restores everything it hid", async ({ page }) => {
    await gotoTree(page);
    await page.fill(search, "button");
    await expect(page.locator(node("atoms/contrast-fail"))).toHaveAttribute("hidden", /.*/);

    await page.fill(search, "");

    await expect(page.locator(node("atoms/contrast-fail"))).not.toHaveAttribute("hidden", /.*/);
    await expect(page.locator(".sidebar-tree .tree-node[data-hidden-search]")).toHaveCount(0);
  });
});
