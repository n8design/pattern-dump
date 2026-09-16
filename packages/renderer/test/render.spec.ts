import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const patternsDir = join(here, "fixtures");

describe("render() — atom: data + variants", () => {
  const render = createRenderer({ patternsDir });

  it("renders a component with its default data", async () => {
    const out = await render({ component: "atoms/button" });
    expect(out.html).toContain("Click me");
    expect(out.html).toContain("hoo-button");
  });

  it("deep-merges a ~variant over the defaults", async () => {
    const out = await render({ component: "atoms/button", variant: "secondary" });
    expect(out.html).toContain("Cancel"); // label from variant
  });

  it("applies live data at the highest precedence", async () => {
    const out = await render({ component: "atoms/button", variant: "secondary", data: { label: "Live" } });
    expect(out.html).toContain("Live");
  });

  it("is deterministic", async () => {
    const a = await render({ component: "atoms/button" });
    const b = await render({ component: "atoms/button" });
    expect(a.html).toBe(b.html);
  });

  it("emits a standalone document wrapping the fragment", async () => {
    const out = await render({ component: "atoms/button" });
    expect(out.document).toContain(out.html);
  });
});
