import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const patternsDir = join(here, "fixtures");

// Milestone 1: composition via the FLAT partial name (<category>-<name>), with the data
// cascade flowing parent -> child. Component ids are full paths; partial refs are flat names.
describe("render() — molecule: flat-name composition", () => {
  const render = createRenderer({ patternsDir });

  it("composes via the flat partial name molecules-input", async () => {
    const out = await render({ component: "molecules/field" });
    expect(out.html).toContain("hoo-field");
    expect(out.html).toContain("Email");
    expect(out.html).toContain("<input"); // the molecules-input partial resolved + rendered
  });

  it("passes parent context down to the sub-component (cascade through composition)", async () => {
    const out = await render({ component: "molecules/field" });
    expect(out.html).toContain('type="email"'); // field.json wins over input.json default "text"
    expect(out.html).not.toContain('type="text"');
  });

  it("renders conditional fragments from data", async () => {
    const out = await render({ component: "molecules/field" });
    expect(out.html).toContain("We never share it.");
  });

  it("is deterministic for the composed molecule", async () => {
    const a = await render({ component: "molecules/field" });
    const b = await render({ component: "molecules/field" });
    expect(a.html).toBe(b.html);
  });
});