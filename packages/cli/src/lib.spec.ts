// The published package's entry exports the config's types, the site's Site* names and their deprecated Storefront*
// aliases alike. Checked by the type checker (npm run typecheck).
import { describe, expectTypeOf, it } from "vitest";
import type { SiteConfig, SiteNavEntry, StorefrontConfig, StorefrontNavEntry } from "./lib.js";
import { defineConfig } from "./lib.js";

describe("the package's library entry", () => {
  it("exports the Site* types and their Storefront* aliases", () => {
    expectTypeOf<StorefrontNavEntry>().toEqualTypeOf<SiteNavEntry>();
    expectTypeOf<SiteConfig["globals"]>().toEqualTypeOf<StorefrontConfig["site"]>();
    expectTypeOf(defineConfig).toBeFunction();
  });
});
