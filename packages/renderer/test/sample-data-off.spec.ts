// A render without sample data (RenderInput.sampleData: false), as a site page renders: the component's own .json,
// its variant's and every included partial's are left out, so only what the render is given, the template's defaults
// ({{defaultValue}}) and the project's data are used. Without it, the cascade is as before: the workbench and its
// previews show each component with its sample data, and a variant with its base's beneath its own. (A partial's
// sample sits beneath its context, which carries the project's data: the layout's currency wins over the price's.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderer } from "../src/index.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let render: ReturnType<typeof createRenderer>;
const FILES: Record<string, string> = {
  "atoms/price/price.hbs": `<p class="price">{{defaultValue amount "?"}} {{currency}}</p>`,
  "atoms/price/price.json": JSON.stringify({ amount: "€12.00", currency: "EUR" }),
  "atoms/price/price~sale.json": JSON.stringify({ amount: "€9.00" }),
  "layouts/shop/shop.hbs": `<main><h1>{{title}}</h1>{{> atoms-price }}{{promo}}</main>`,
  "layouts/shop/shop.json": JSON.stringify({ title: "Sample title", promo: "Sample promo" }),
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-sample-off-"));
  for (const [rel, text] of Object.entries(FILES)) await save(join(tmp, rel), text);
  render = createRenderer({ patternsDir: tmp, globalData: { currency: "project" } });
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("a render without sample data", () => {
  it("uses only its data, the template's defaults and the project's data: no sample value, its own or a partial's", async () => {
    const out = await render({ component: "layouts/shop", data: { title: "Real title" }, sampleData: false });
    expect(out.html).toBe(`<main><h1>Real title</h1><p class="price">? project</p></main>`);
  });

  it("leaves a variant's data and its base's out too", async () => {
    expect((await render({ component: "atoms/price", variant: "sale", sampleData: false })).html).toBe(`<p class="price">? project</p>`);
  });

  it("the default keeps the cascade: own sample, partials' samples, a variant over its base", async () => {
    expect((await render({ component: "layouts/shop", data: { title: "Real title" } })).html)
      .toBe(`<main><h1>Real title</h1><p class="price">€12.00 project</p>Sample promo</main>`);
    expect((await render({ component: "atoms/price", variant: "sale" })).html).toBe(`<p class="price">€9.00 EUR</p>`);
  });
});
