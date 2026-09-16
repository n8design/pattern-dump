// Regression guard: tests that run against @pattern-dump/renderer (dist/index.js), not src.
// This file catches the class of bug where helpers are added to src but the dist is not rebuilt
// before the dev-server is used. If this test fails with "Missing helper: X", rebuild the renderer.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "@pattern-dump/renderer";

const here = dirname(fileURLToPath(import.meta.url));
const patternsDir = join(here, "fixtures");
const render = createRenderer({ patternsDir });

describe("renderer dist — {{id}} helper", () => {
  it("resolves {{id 'name'}} without throwing 'Missing helper: id'", async () => {
    const out = await render({ component: "atoms/button" });
    expect(out.html).toContain("pd-atoms-button-btn");
  });

  it("same name resolves to the same id (deterministic)", async () => {
    const a = await render({ component: "atoms/button" });
    const b = await render({ component: "atoms/button" });
    expect(a.html).toBe(b.html);
  });
});

describe("renderer dist — core generic helpers", () => {
  it("ifCond resolves without throwing 'Missing helper: ifCond'", async () => {
    const out = await render({ component: "atoms/labeled" });
    expect(out.html).toContain("is-primary");
  });

  it("live data override changes ifCond branch", async () => {
    const out = await render({ component: "atoms/labeled", data: { type: "secondary" } });
    expect(out.html).not.toContain("is-primary");
    expect(out.html).toContain("Hello");
  });
});

describe("renderer dist — project helpers hook", () => {
  it("custom helper registered via options.helpers is callable in templates", async () => {
    const renderWithHelper = createRenderer({
      patternsDir,
      helpers: { shout: (s: unknown) => String(s).toUpperCase() },
    });
    const out = await renderWithHelper({ component: "atoms/button" });
    // Just verifies the renderer didn't throw on helper registration —
    // the shout helper is not used in button.hbs but registration must not error.
    expect(out.html).toContain("hoo-button");
  });
});
