// A page's place in the site (positionOf in derived.ts): its section, its breadcrumbs through the folders,
// and its previous and next pages in the nav read depth first, across sections.
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { StorefrontPagesResponse } from "@pattern-dump/contracts";
import { positionOf } from "../src/storefront/derived.js";
import { readPages } from "../src/storefront/pages.js";

const link = (route: string, title: string) => ({ route, title });
const HOME = link("/", "Home"), GUIDES = link("/guides/", "Guides"), SETUP = link("/guides/setup/", "Setup");
const DEEP = link("/guides/deep/", "Deep"), ABOUT = link("/about/", "About"), MORE = link("/guides/deep/more/", "More");

/** Home, Guides (Setup, Deep), About in the nav; /guides/deep/leaf/ and the folder /guides/deep/more/ with
 *  its page are deeper than the nav (one level) lists. */
const SITE: StorefrontPagesResponse = {
  pages: [HOME, GUIDES, SETUP, DEEP, link("/guides/deep/leaf/", "Leaf"), MORE, link("/guides/deep/more/end/", "End"), ABOUT]
    .map(p => ({ ...p, layout: "page" })),
  nav: [HOME, { ...GUIDES, children: [SETUP, DEEP] }, ABOUT],
};

describe("positionOf", () => {
  it("a top-level page is its own section, with Home as its one breadcrumb", () => {
    expect(positionOf("/about/", SITE)).toEqual({ section: ABOUT, breadcrumbs: [HOME], prev: DEEP, next: null });
  });

  it("a depth-2 page is in its folder's section, with breadcrumbs through that folder", () => {
    expect(positionOf("/guides/setup/", SITE)).toEqual({ section: GUIDES, breadcrumbs: [HOME, GUIDES], prev: GUIDES, next: DEEP });
  });

  it("a depth-3 page has a section and breadcrumbs through every folder, and no neighbours outside the nav", () => {
    expect(positionOf("/guides/deep/leaf/", SITE)).toEqual({ section: GUIDES, breadcrumbs: [HOME, GUIDES, DEEP], prev: null, next: null });
  });

  it("breadcrumbs come from the folders, through one the nav does not list", () => {
    expect(positionOf("/guides/deep/more/end/", SITE)).toEqual({ section: GUIDES, breadcrumbs: [HOME, GUIDES, DEEP, MORE], prev: null, next: null });
  });

  it("the first entry has no previous page, and the home page no breadcrumbs", () => {
    expect(positionOf("/", SITE)).toEqual({ section: HOME, breadcrumbs: [], prev: null, next: GUIDES });
  });

  it("the last entry has no next page", () => {
    expect(positionOf("/about/", SITE).next).toBeNull();
  });

  it("previous and next cross a section boundary", () => {
    expect(positionOf("/guides/deep/", SITE)).toMatchObject({ prev: SETUP, next: ABOUT });
    expect(positionOf("/about/", SITE).prev).toEqual(DEEP);
  });

  it("a folder's index page is in its own section", () => {
    expect(positionOf("/guides/", SITE)).toEqual({ section: GUIDES, breadcrumbs: [HOME], prev: HOME, next: SETUP });
  });

  it("reads only the pages and the nav, which the watcher's pages fingerprint covers", async () => {
    const model = await readPages(fileURLToPath(new URL("../../../storefront-bench/pages/", import.meta.url)));
    const fingerprinted = JSON.parse(JSON.stringify({ pages: model.pages, nav: model.nav })) as StorefrontPagesResponse;
    for (const route of model.files.keys()) expect(positionOf(route, fingerprinted), route).toEqual(positionOf(route, model));
  });
});
