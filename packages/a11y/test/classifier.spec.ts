import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as typeof import("axe-core");

const FIXTURES: { ruleId: string; fixture: string; expectedVerdict: "jsdom-clean" | "needs-rendering" }[] = [
  { ruleId: "image-alt",             fixture: '<img src="x.jpg">',                                     expectedVerdict: "jsdom-clean" },
  { ruleId: "label",                 fixture: '<input type="text">',                                   expectedVerdict: "jsdom-clean" },
  { ruleId: "button-name",           fixture: "<button></button>",                                     expectedVerdict: "jsdom-clean" },
  { ruleId: "link-name",             fixture: '<a href="#"></a>',                                      expectedVerdict: "jsdom-clean" },
  { ruleId: "aria-required-attr",    fixture: '<div role="checkbox"></div>',                           expectedVerdict: "jsdom-clean" },
  { ruleId: "aria-valid-attr",       fixture: '<div aria-xyz="true"></div>',                           expectedVerdict: "jsdom-clean" },
  { ruleId: "aria-valid-attr-value", fixture: '<div role="textbox" aria-expanded="maybe"></div>',      expectedVerdict: "jsdom-clean" },
  { ruleId: "autocomplete-valid",    fixture: '<input autocomplete="foo">',                            expectedVerdict: "jsdom-clean" },
  { ruleId: "duplicate-id",          fixture: '<div id="d1"></div><div id="d1"></div>',               expectedVerdict: "jsdom-clean" },
  { ruleId: "aria-hidden-focus",     fixture: '<div aria-hidden="true"><button>x</button></div>',     expectedVerdict: "needs-rendering" },
  { ruleId: "duplicate-id-aria",     fixture: '<span id="x"></span><span id="x"></span><input aria-labelledby="x">', expectedVerdict: "needs-rendering" },
  { ruleId: "color-contrast",        fixture: '<p style="color:#bbb;background:#fff">Low contrast</p>', expectedVerdict: "needs-rendering" },
];

async function probe(ruleId: string, fixture: string) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="en"><body><main>${fixture}</main></body></html>`,
    { url: "http://localhost" }
  );
  return axe.run(
    dom.window.document.querySelector("main")!,
    { runOnly: { type: "rule", values: [ruleId] } }
  );
}

describe("classifier verdicts", () => {
  for (const { ruleId, fixture, expectedVerdict } of FIXTURES) {
    it(`${ruleId} → ${expectedVerdict}`, async () => {
      const results = await probe(ruleId, fixture);
      if (expectedVerdict === "jsdom-clean") {
        expect(results.violations.length).toBeGreaterThan(0);
        expect(results.incomplete.length).toBe(0);
      } else {
        expect(results.violations.length).toBe(0);
        expect(results.incomplete.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("generated artifact consistency", () => {
  it("alwaysOn array matches observed jsdom-clean rules", () => {
    const artifactPath = join(dirname(fileURLToPath(import.meta.url)), "../src/rule-tiers.generated.json");
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      alwaysOn: string[];
      needsRendering: string[];
    };
    const expectedAlwaysOn = FIXTURES
      .filter(f => f.expectedVerdict === "jsdom-clean")
      .map(f => f.ruleId);
    const expectedNeedsRendering = FIXTURES
      .filter(f => f.expectedVerdict === "needs-rendering")
      .map(f => f.ruleId);
    expect(artifact.alwaysOn).toEqual(expectedAlwaysOn);
    expect(artifact.needsRendering).toEqual(expectedNeedsRendering);
  });

  it("investigate array is empty", () => {
    const artifactPath = join(dirname(fileURLToPath(import.meta.url)), "../src/rule-tiers.generated.json");
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as { investigate: string[] };
    expect(artifact.investigate).toHaveLength(0);
  });
});
