// Which axe rules decide in jsdom, and which need a browser, was measured with one axe-core release (the tier lists'
// axeVersion). Another release can add a rule that runs nowhere, or change one so its results are dropped, and the
// check would still say "checked". So axe-core and jsdom are declared at exact versions, and a run with any other axe
// installed stops, naming both versions.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { assertAxeVersion, AxeVersionError, installedAxeVersion } from "../src/axe-version.js";
import ruleTiers from "../src/rule-tiers.generated.json" with { type: "json" };
import pageTiers from "../src/page-rule-tiers.generated.json" with { type: "json" };

const require = createRequire(import.meta.url);
const manifest = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as { dependencies: Record<string, string> };

describe("the axe-core the tier lists were proven on", () => {
  it("is the one installed, and both lists name it", () => {
    expect(installedAxeVersion()).toBe(ruleTiers.axeVersion);
    expect(pageTiers.axeVersion).toBe(ruleTiers.axeVersion);
  });

  it("is declared exactly, as jsdom is, at the installed versions", () => {
    const a11y = manifest("../package.json").dependencies;
    expect(a11y["axe-core"]).toBe(ruleTiers.axeVersion);
    expect(a11y.jsdom).toBe((require("jsdom/package.json") as { version: string }).version);
    expect(manifest("../../dev-server/package.json").dependencies["axe-core"]).toBe(ruleTiers.axeVersion);
  });
});

describe("assertAxeVersion", () => {
  it("passes for the listed version", () => {
    expect(() => assertAxeVersion(ruleTiers.axeVersion)).not.toThrow();
  });

  it("stops for any other, naming both", () => {
    expect(() => assertAxeVersion("4.99.0")).toThrow(AxeVersionError);
    expect(() => assertAxeVersion("4.99.0")).toThrow(
      `axe-core 4.99.0 is installed, but the accessibility rule tiers were proven on ${ruleTiers.axeVersion}: install axe-core ${ruleTiers.axeVersion}`);
  });
});
