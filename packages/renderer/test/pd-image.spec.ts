// {{pd-image field alt=…}}: the field's slot found from the component's schema (image-slots.ts), the image looked up in
// the index the renderer is given (RendererOptions.images), written as an <img> with its variants. A fake lookup
// stands in for the dev-server's index here, so these tests need neither the build package nor sharp.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ImageLookup } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { checkSchemaExtensions, createRenderer } from "../src/index";
import { save } from "../../../test-support/save.js";

const SLOT = { widths: [480, 960, 1440], sizes: "(max-width: 40rem) 100vw, 40rem" };
const lookup: ImageLookup = src => {
  if (src === "/assets/images/harbour.jpg") return { kind: "variants", width: 1000, height: 500, variantUrl: (w, s) => `/v/${s ?? "project"}/harbour-${w}.webp` };
  if (src === "/assets/images/logo.svg") return { kind: "single", url: src, width: 64, height: 32 };
  if (src === "/assets/images/broken.jpg") return { kind: "unavailable", reason: "Pattern Dump could not load sharp (test)" };
  return undefined;
};
let root = "";
let render: ReturnType<typeof createRenderer>;

const files: Record<string, string> = {
  "atoms/pic/pic.hbs": `{{pd-image image alt=alt}}`,
  "atoms/pic/pic.schema.json": JSON.stringify({ properties: { image: { type: "string", "x-pd-image": SLOT }, alt: { type: "string" } } }),
  "atoms/pic/pic.json": JSON.stringify({ image: "/assets/images/harbour.jpg", alt: "A harbour" }),
  "atoms/pic/pic~logo.json": JSON.stringify({ image: "/assets/images/logo.svg", alt: "" }),
  "atoms/pic/pic~broken.json": JSON.stringify({ image: "/assets/images/broken.jpg", alt: "x" }),
  "atoms/pic/pic~noalt.json": JSON.stringify({ alt: null }),
  "atoms/hero/hero.hbs": `{{pd-image image alt=alt loading="eager"}}`,
  "atoms/hero/hero.schema.json": JSON.stringify({ properties: { image: { type: "string", "x-pd-image": { widths: [320, 2000], sizes: "100vw" } }, alt: { type: "string" } } }),
  "atoms/hero/hero.json": JSON.stringify({ image: "/assets/images/harbour.jpg", alt: "Hero" }),
  "molecules/gallery/gallery.hbs": `{{#each items}}{{pd-image photo alt=caption}}{{/each}}|{{> atoms-pic image="/assets/images/harbour.jpg" alt="Nested"}}`,
  "molecules/gallery/gallery.schema.json": JSON.stringify({ properties: { items: { type: "array", items: { properties: {
    photo: { type: "string", "x-pd-image": { widths: [480], sizes: "50vw" } }, caption: { type: "string" } } } } } }),
  "molecules/gallery/gallery.json": JSON.stringify({ items: [{ photo: "/assets/images/harbour.jpg", caption: "First" }] }),
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-image-helper-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  const { discoveryMap, handleMap } = await buildDiscoveryMap(root);
  render = createRenderer({ patternsDir: root, discoveryMap, handleMap, images: lookup });
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const v = (s: string, w: number) => `/v/${s}/harbour-${w}.webp`;

describe("{{pd-image}}", () => {
  it("writes the image as an <img> with its slot's variants, as wide as the image is, sized and lazy", async () => {
    expect((await render({ component: "atoms/pic" })).html.trim()).toBe(
      `<img src="${v("project", 960)}" srcset="${v("project", 480)} 480w, ${v("project", 960)} 960w" sizes="(max-width: 40rem) 100vw, 40rem" `
      + `width="960" height="480" alt="A harbour" loading="lazy" decoding="async">`);
  });

  it("keys the variants with the site's settings when the render says so", async () => {
    expect((await render({ component: "atoms/pic", images: "site" })).html).toContain(`src="${v("site", 960)}"`);
  });

  it("passes the settings into a nested component, and resolves a field inside {{#each}}", async () => {
    const html = (await render({ component: "molecules/gallery", images: "site" })).html.trim();
    expect(html).toBe(
      `<img src="${v("site", 480)}" srcset="${v("site", 480)} 480w" sizes="50vw" width="480" height="240" alt="First" loading="lazy" decoding="async">|`
      + `<img src="${v("site", 960)}" srcset="${v("site", 480)} 480w, ${v("site", 960)} 960w" sizes="(max-width: 40rem) 100vw, 40rem" width="960" height="480" alt="Nested" loading="lazy" decoding="async">`);
  });

  it("uses the image's own width when every slot width beyond the smallest is wider, and loads eager when asked", async () => {
    expect((await render({ component: "atoms/hero" })).html.trim()).toBe(
      `<img src="${v("project", 320)}" srcset="${v("project", 320)} 320w" sizes="100vw" width="320" height="160" alt="Hero" loading="eager" decoding="async">`);
  });

  it("writes an SVG as one file at its size, and alt=\"\" for a decorative image", async () => {
    expect((await render({ component: "atoms/pic", variant: "logo" })).html.trim()).toBe(
      `<img src="/assets/images/logo.svg" width="64" height="32" alt="" loading="lazy" decoding="async">`);
  });

  it("fails the render with the lookup's reason when the image can't be served as variants", async () => {
    await expect(render({ component: "atoms/pic", variant: "broken" })).rejects.toThrow("Pattern Dump could not load sharp (test)");
  });

  it("fails the render when the alt text is missing at render time", async () => {
    await expect(render({ component: "atoms/pic", variant: "noalt" })).rejects.toThrow(/the image's alt text is missing/);
  });
});

describe("{{pd-image}} problems, found from the schema before rendering", () => {
  const ctx = { componentExists: () => true, hasSchema: () => true };
  const schema = { properties: { image: { type: "string", "x-pd-image": SLOT }, plain: { type: "string" }, alt: { type: "string" } } };
  const problems = (template: string, s: unknown = schema) => checkSchemaExtensions(s, template, ctx).map(p => p.message);

  it("passes a call that names a slotted field and gives alt", () => {
    expect(problems(`<figure>{{pd-image image alt=alt}}</figure>`)).toEqual([]);
  });

  it("names a field the schema doesn't declare, a field with no slot, a missing alt, and a slot written by hand", () => {
    expect(problems(`{{pd-image picture alt=alt}}\n{{pd-image plain alt=alt}}\n{{pd-image image}}\n{{pd-image image alt=alt pd-slot="x"}}\n{{pd-image "x.jpg" alt=alt}}`)).toEqual([
      `{{pd-image}} at 1:1: "picture" is not a field this component's schema declares`,
      `{{pd-image}} at 2:1: the field "plain" declares no image slot (x-pd-image with its widths and sizes)`,
      `{{pd-image}} at 3:1 needs alt=…: the image's text alternative, or alt="" for a decorative image`,
      `{{pd-image}} at 4:1: "pd-slot" is set by Pattern Dump, not in a template`,
      `{{pd-image}} at 5:1 takes the image field as its first argument, such as {{pd-image image alt=alt}}`,
    ]);
  });

  it("checks x-pd-image itself: only on a string, widths ascending whole numbers, sizes given", () => {
    const bad = (prop: unknown) => checkSchemaExtensions({ properties: { image: prop } }, undefined, ctx).map(p => `${p.path}: ${p.message}`);
    expect(bad({ type: "string", "x-pd-image": SLOT })).toEqual([]);
    expect(bad({ type: "integer", "x-pd-image": SLOT })).toEqual([`#/properties/image/x-pd-image: x-pd-image is only for a string property: the path of an image in the assets`]);
    const shape = `#/properties/image/x-pd-image: x-pd-image must be { "widths": [...], "sizes": "..." }: widths whole numbers above 0 in ascending order, sizes the <img> sizes value (with no double quote)`;
    for (const slot of [{ widths: [960, 480], sizes: "x" }, { widths: [], sizes: "x" }, { widths: [480.5], sizes: "x" }, { widths: [480], sizes: "" },
      { widths: [480], sizes: `a"b` }, { widths: [480] }, { widths: [480], sizes: "x", aspect: "3/2" }]) {
      expect(bad({ type: "string", "x-pd-image": slot }), JSON.stringify(slot)).toEqual([shape]);
    }
  });
});
