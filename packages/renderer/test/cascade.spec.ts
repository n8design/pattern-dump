import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const patternsDir = join(here, "fixtures");
const render = createRenderer({ patternsDir });

describe("cascade — per-key deep merge (not whole-object replace)", () => {
  it("a ~save variant overriding only `label` renders the variant label", async () => {
    const out = await render({ component: "atoms/button", variant: "save" });
    expect(out.html).toContain("Save");     // from variant
    expect(out.html).toContain("hoo-button"); // base class still present
  });

  it("live data wins over variant, per key", async () => {
    const out = await render({
      component: "atoms/button",
      variant: "save",
      data: { label: "Override" }, // live beats variant's "Save"
    });
    expect(out.html).toContain("Override"); // live wins
    expect(out.html).not.toContain("Save"); // variant's label is overridden
  });
});

describe("cascade — .json is optional (only .hbs required)", () => {
  it("a component with no .json renders from its template alone", async () => {
    const out = await render({ component: "atoms/divider" });
    expect(out.html).toContain("hoo-divider");
  });

  it("a .json-less component still receives supplied data through the cascade", async () => {
    const out = await render({ component: "atoms/divider", data: { modifier: "is-bold" } });
    expect(out.html).toContain("is-bold");
  });
});

describe("composition — section descent + bare-partial inheritance", () => {
  it("renders the same atoms-button twice from two namespaced data subtrees", async () => {
    const out = await render({ component: "organisms/buttonbar" });
    expect(out.html).toContain("Save");   // from saveBtn subtree
    expect(out.html).toContain("Cancel"); // from cancelBtn subtree
  });

  it("a parent-supplied subtree overrides the child default through descent (data only, no template value)", async () => {
    const out = await render({
      component: "organisms/buttonbar",
      data: { saveBtn: { label: "Submit" } },
    });
    expect(out.html).toContain("Submit"); // overridden via JSON
    expect(out.html).toContain("Cancel"); // untouched
  });
});

describe("cascade — determinism", () => {
  it("same input always yields identical output (snapshots/caching depend on this)", async () => {
    const a = await render({ component: "organisms/buttonbar" });
    const b = await render({ component: "organisms/buttonbar" });
    expect(a.html).toBe(b.html);
  });
});

describe("schema alignment — the 'why is it blank' guard", () => {
  it("flags a missing required field as UNFILLED_REQUIRED error in meta.diagnostics", async () => {
    // button.schema.json requires ["label", "variant"]; fixture default only has "label"
    const out = await render({ component: "atoms/button", data: {} });
    const diags = out.meta?.diagnostics ?? [];
    const unfilled = diags.filter(d => d.kind === "UNFILLED_REQUIRED");
    expect(unfilled.length).toBeGreaterThan(0);
    expect(unfilled[0].severity).toBe("error");
    expect(unfilled[0].source).toBe("schema");
    expect(unfilled[0].path).toMatch(/^#\/properties\//);
  });

  it("still renders the HTML even when required fields are absent", async () => {
    const out = await render({ component: "atoms/button", data: {} });
    expect(out.html).toContain("hoo-button");
  });

  it("emits no diagnostics when all required fields are present", async () => {
    const out = await render({ component: "atoms/button", data: { variant: "primary" } });
    expect(out.meta?.diagnostics?.some(d => d.kind === "UNFILLED_REQUIRED")).toBeFalsy();
  });
});
