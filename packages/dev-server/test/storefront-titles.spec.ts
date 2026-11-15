// The <title> of the documents a storefront serves besides its pages: a page with problems names the route after a
// middle dot, as a page's own title names the site ("Setup · Storefront bench", storefront-page.spec.ts).
import { describe, expect, it } from "vitest";
import { errorDocument } from "../src/storefront/page.js";

describe("the problems page's title", () => {
  it("is Problems · <route>, escaped", () => {
    expect(errorDocument("/guides/<x>/", ["a problem"], undefined)).toContain("<title>Problems · /guides/&lt;x&gt;/</title>");
  });
});
