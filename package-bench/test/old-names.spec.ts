// The bench's config keeps the names from before 0.8.0 on purpose (`storefront`, and `storefront.site`): loading it
// warns once per key, naming the new one, and gives the same config as the new names would.
import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { loadConfig } from "@pattern-dump/core";
import benchConfig from "../pattern-dump.config.js";

const bench = fileURLToPath(new URL("../", import.meta.url));

describe("the bench's config, on the old names", () => {
  it("warns once per key, naming the new one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await loadConfig(bench);
      expect(warn.mock.calls.map(c => String(c[0]))).toEqual([
        "[pd] warning: pattern-dump.config.ts: storefront.pagesDir is now site.pagesDir",
        "[pd] warning: pattern-dump.config.ts: storefront.outDir is now site.outDir",
        "[pd] warning: pattern-dump.config.ts: storefront.workbenchUrl is now site.workbenchUrl",
        "[pd] warning: pattern-dump.config.ts: storefront.url is now site.url",
        "[pd] warning: pattern-dump.config.ts: storefront.site is now site.globals",
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("loads as the same config written with the new names", () => {
    const { storefront, ...rest } = benchConfig;
    const { site: globals, ...keys } = storefront!;
    expect(validateConfig(benchConfig, "old")).toEqual(validateConfig({ ...rest, site: { ...keys, globals } }, "new"));
  });
});
