// A data-overlay variant is its base component with the variant's data on top — however it is
// reached: `?variant=`, its own id (`/preview/atoms/tag~alert`), or an include of its handle.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const render = createRenderer({ patternsDir: join(here, "fixtures") });

describe("data-overlay variants keep the base data", () => {
  it("rendered by its own id, a variant equals the ?variant= render", async () => {
    const byId = await render({ component: "atoms/tag~alert" });
    const byParam = await render({ component: "atoms/tag", variant: "alert" });
    expect(byId.html).toBe(byParam.html);
    expect(byId.html).toContain('<span class="tag alert">Tag</span>');
  });

  it("an include of the variant's handle gets the base data beneath the variant's", async () => {
    const out = await render({ component: "molecules/tag-include" });
    expect(out.html).toContain('<span class="tag alert">Tag</span>');
  });
});
