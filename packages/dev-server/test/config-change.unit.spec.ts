// Which config changes pd dev can take live: storefront.site alone, nothing else.
import { describe, expect, it } from "vitest";
import type { PatternDumpConfig } from "@pattern-dump/config";
import { classifyConfigChange } from "../src/config-change.js";

const base = (): PatternDumpConfig => ({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./.out",
  styles: { strategy: "parallel", dir: "./src/styles" },
  storefront: {
    pagesDir: "./pages",
    outDir: "./.out/storefront",
    site: { title: "Site", footer: "Old footer", links: { home: "/" } },
  },
});

describe("classifyConfigChange", () => {
  it("is none when nothing differs", () => {
    expect(classifyConfigChange(base(), base())).toBe("none");
  });

  it("is none when only key order differs, at any level", () => {
    const next = base();
    next.storefront = { site: { links: { home: "/" }, footer: "Old footer", title: "Site" }, outDir: "./.out/storefront", pagesDir: "./pages" };
    expect(classifyConfigChange(base(), next)).toBe("none");
  });

  it("is site when only a storefront.site value differs", () => {
    const next = base();
    next.storefront!.site = { ...next.storefront!.site, footer: "New footer" };
    expect(classifyConfigChange(base(), next)).toBe("site");
  });

  it("is site when a nested storefront.site value differs", () => {
    const next = base();
    next.storefront!.site = { ...next.storefront!.site, links: { home: "/start/" } };
    expect(classifyConfigChange(base(), next)).toBe("site");
  });

  it("is site when storefront.site is added or removed", () => {
    const without = base();
    delete without.storefront!.site;
    expect(classifyConfigChange(without, base())).toBe("site");
    expect(classifyConfigChange(base(), without)).toBe("site");
  });

  it("is other when anything outside storefront.site differs", () => {
    const next = base();
    next.outDir = "./.out2";
    expect(classifyConfigChange(base(), next)).toBe("other");
  });

  it("is other when another storefront key differs", () => {
    const next = base();
    next.storefront!.pagesDir = "./content";
    expect(classifyConfigChange(base(), next)).toBe("other");
  });

  it("is other when storefront.site and something else both differ", () => {
    const next = base();
    next.outDir = "./.out2";
    next.storefront!.site = { ...next.storefront!.site, footer: "New footer" };
    expect(classifyConfigChange(base(), next)).toBe("other");
  });

  it("is other when the storefront is added or removed", () => {
    const without = base();
    delete without.storefront;
    expect(classifyConfigChange(without, base())).toBe("other");
    expect(classifyConfigChange(base(), without)).toBe("other");
  });
});
