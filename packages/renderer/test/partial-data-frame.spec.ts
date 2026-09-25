// Included partials keep the caller's Handlebars data frame, as in stock Handlebars: `@root` is the
// page's data (not the partial's own context), `@index` comes through from the caller's #each, and a
// block call exposes its body as the `@partial-block` data variable that `{{#if @partial-block}}` reads.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const render = createRenderer({ patternsDir: join(here, "fixtures") });

describe("partials keep the caller's data frame", () => {
  it("@root inside a partial rendered in #each is the page's data", async () => {
    const out = await render({ component: "molecules/root-list" });
    expect(out.html).toContain("<i>a:Page:0</i>");
    expect(out.html).toContain("<i>b:Page:1</i>");
  });

  it("{{#if @partial-block}} is true for a block call and false for a plain call", async () => {
    const out = await render({ component: "molecules/guarded-caller" });
    expect(out.html).toContain("<div><p>block body</p></div>");
    expect(out.html).toContain("<div>no block</div>");
  });

  it("the guarded partial viewed on its own renders its no-block branch", async () => {
    const out = await render({ component: "atoms/guarded-block" });
    expect(out.html).toContain("<div>no block</div>");
  });
});
