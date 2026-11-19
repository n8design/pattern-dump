// The website's types are named Site*; each Storefront* name from before 0.8.0 is a deprecated alias of the same type
// until 1.0, so a config typed with either still compiles. Checked by the type checker (npm run typecheck).
import { describe, expectTypeOf, it } from "vitest";
import type {
  SiteCategory, SiteChecks, SiteNavEntry, SiteTag, SiteTermPages,
  StorefrontCategory, StorefrontChecks, StorefrontNavEntry, StorefrontTag, StorefrontTermPages,
} from "./index.js";

describe("the site's type names", () => {
  it("each Storefront* type is the same type as its Site* name", () => {
    expectTypeOf<StorefrontChecks>().toEqualTypeOf<SiteChecks>();
    expectTypeOf<StorefrontTermPages>().toEqualTypeOf<SiteTermPages>();
    expectTypeOf<StorefrontTag>().toEqualTypeOf<SiteTag>();
    expectTypeOf<StorefrontCategory>().toEqualTypeOf<SiteCategory>();
    expectTypeOf<StorefrontNavEntry>().toEqualTypeOf<SiteNavEntry>();
  });
});
