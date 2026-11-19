// Images in a storefront page's markdown (frame mode): a raster from the assets is written as the same <img> as
// {{pd-image}}'s, in the slot its layout declares (x-pd-prose-images), lazy with `sizes="auto, …"`, the first
// `eager` at once with the declared sizes alone; an SVG at its size; an empty alt, a raster with no slot, a path the
// assets don't have and an image that can't be encoded are page problems, at their line. Remote images are left as
// they are (the <img> checks are PR 5's), and the workbench's docs (inline mode) are not touched at all.
import { describe, expect, it } from "vitest";
import type { DiscoveryMap, ImageLookup, ImageSource } from "@pattern-dump/contracts";
import { renderDoc, type ProseImages } from "../src/markdown.js";

const raster = (width: number, height: number, name = "photo"): ImageSource => ({
  kind: "variants", width, height,
  variantUrl: (w, settings) => `/_pd/images/${name}.k${settings ?? "-"}.${w}.webp`,
});
const IMAGES: Record<string, ImageSource> = {
  "/assets/images/photo.jpg": raster(1200, 800),
  "/assets/images/small.jpg": raster(400, 300),
  "/assets/images/mark.svg": { kind: "single", url: "/assets/images/mark.svg", width: 48, height: 24 },
  "/assets/images/broken.jpg": { kind: "unavailable", reason: "sharp could not be loaded (test)" },
  "/assets/images/chart.png": raster(1000, 500, "chart"),
  "/assets/images/chart-dark.png": raster(1000, 500, "chart-dark"),
  "/assets/images/logo.svg": { kind: "single", url: "/assets/images/logo.svg", width: 40, height: 20 },
  "/assets/images/logo-dark.svg": { kind: "single", url: "/assets/images/logo-dark.svg", width: 40, height: 20 },
  "/assets/images/night.jpg": raster(800, 600, "night"),
  "/assets/images/night-dark.jpg": { kind: "unavailable", reason: "it is not an image sharp can read (test)" },
};
const lookup: ImageLookup = src => IMAGES[src];
const SLOT = { widths: [480, 960], sizes: "(min-width: 60rem) 40rem, 100vw", eager: 0 };

async function page(body: string, o: { slot?: typeof SLOT | undefined; lineOffset?: number; slotProblem?: string } = {}) {
  const prose: ProseImages = {
    layoutId: "layouts/page", lookup, lineOffset: o.lineOffset ?? 0, problems: [],
    ...(o.slotProblem ? { slotProblem: o.slotProblem } : {}),
    ...("slot" in o ? (o.slot ? { slot: o.slot } : {}) : { slot: SLOT }),
  };
  const docProblems: string[] = [];
  const html = await renderDoc(body, async () => "", new Map() as DiscoveryMap,
    { embed: "frame", workbenchUrl: "/wb/", problems: docProblems, prose });
  return { html, problems: prose.problems.map(p => `${p.line}: ${p.message}`), docProblems };
}

describe("prose images on a storefront page", () => {
  it("a raster from the assets: its variants in the layout's slot, lazy, sizes auto first, the site's settings", async () => {
    const r = await page(`![A harbour at dawn](/assets/images/photo.jpg)\n`);
    expect(r.problems).toEqual([]);
    expect(r.html).toBe(`<p><img src="/_pd/images/photo.ksite.960.webp" `
      + `srcset="/_pd/images/photo.ksite.480.webp 480w, /_pd/images/photo.ksite.960.webp 960w" `
      + `sizes="auto, (min-width: 60rem) 40rem, 100vw" width="960" height="640" alt="A harbour at dawn" loading="lazy" decoding="async"></p>\n`);
  });

  it("only the widths the image has; its own width when every slot width is wider", async () => {
    const r = await page(`![Small](/assets/images/small.jpg)\n`);
    expect(r.html).toContain(`srcset="/_pd/images/photo.ksite.400.webp 400w"`);
    expect(r.html).toContain(`width="400" height="300"`);
  });

  it("the first `eager` images from the assets load at once, with the declared sizes alone", async () => {
    const r = await page(`![Mark](/assets/images/mark.svg)\n\n![One](/assets/images/photo.jpg)\n\n![Two](/assets/images/photo.jpg)\n`,
      { slot: { ...SLOT, eager: 2 } });
    const imgs = r.html.match(/<img [^>]*>/g) ?? [];
    expect(imgs).toHaveLength(3);
    expect(imgs[0]).toContain(`loading="eager"`);
    expect(imgs[1]).toContain(`loading="eager"`);
    expect(imgs[1]).toContain(`sizes="(min-width: 60rem) 40rem, 100vw"`);
    expect(imgs[2]).toContain(`loading="lazy"`);
    expect(imgs[2]).toContain(`sizes="auto, (min-width: 60rem) 40rem, 100vw"`);
  });

  it("an SVG from the assets: one file at its size, and no slot needed", async () => {
    const r = await page(`![The mark](/assets/images/mark.svg)\n`, { slot: undefined });
    expect(r.problems).toEqual([]);
    expect(r.html).toBe(`<p><img src="/assets/images/mark.svg" width="48" height="24" alt="The mark" loading="lazy" decoding="async"></p>\n`);
  });

  it("with a title, alone on its line: a <figure> with the title as its <figcaption>, and no title attribute", async () => {
    const r = await page(`![A harbour](/assets/images/photo.jpg "At <dawn> & after")\n`);
    expect(r.problems).toEqual([]);
    expect(r.html).toBe(`<figure class="doc-figure">\n<img src="/_pd/images/photo.ksite.960.webp" `
      + `srcset="/_pd/images/photo.ksite.480.webp 480w, /_pd/images/photo.ksite.960.webp 960w" `
      + `sizes="auto, (min-width: 60rem) 40rem, 100vw" width="960" height="640" alt="A harbour" loading="lazy" decoding="async">\n`
      + `<figcaption>At &lt;dawn&gt; &amp; after</figcaption>\n</figure>\n`);
  });

  it("with a title in a line of text: the <img> keeps it as its title", async () => {
    const r = await page(`See ![A harbour](/assets/images/photo.jpg "At dawn") here.\n`);
    expect(r.html).not.toContain("<figure");
    expect(r.html).toContain(`alt="A harbour" title="At dawn" loading="lazy"`);
  });

  it("a sibling <name>-dark.<ext>: a <picture> with a (prefers-color-scheme: dark) source in the same widths", async () => {
    const r = await page(`![Sales by month](/assets/images/chart.png)\n`);
    expect(r.problems).toEqual([]);
    expect(r.html).toBe(`<p><picture><source media="(prefers-color-scheme: dark)" `
      + `srcset="/_pd/images/chart-dark.ksite.480.webp 480w, /_pd/images/chart-dark.ksite.960.webp 960w" `
      + `sizes="auto, (min-width: 60rem) 40rem, 100vw" width="960" height="480">`
      + `<img src="/_pd/images/chart.ksite.960.webp" srcset="/_pd/images/chart.ksite.480.webp 480w, /_pd/images/chart.ksite.960.webp 960w" `
      + `sizes="auto, (min-width: 60rem) 40rem, 100vw" width="960" height="480" alt="Sales by month" loading="lazy" decoding="async">`
      + `</picture></p>\n`);
  });

  it("a dark version with a caption is a <figure> around the <picture>; an SVG's is one file at its size", async () => {
    const fig = await page(`![Sales by month](/assets/images/chart.png "2026")\n`);
    expect(fig.html).toMatch(/^<figure class="doc-figure">\n<picture><source media="\(prefers-color-scheme: dark\)" [^>]+><img [^>]+><\/picture>\n<figcaption>2026<\/figcaption>\n<\/figure>\n$/);
    const svg = await page(`![The logo](/assets/images/logo.svg)\n`, { slot: undefined });
    expect(svg.html).toBe(`<p><picture><source media="(prefers-color-scheme: dark)" srcset="/assets/images/logo-dark.svg" width="40" height="20">`
      + `<img src="/assets/images/logo.svg" width="40" height="20" alt="The logo" loading="lazy" decoding="async"></picture></p>\n`);
  });

  it("no sibling, or the dark file named itself: a plain <img>; a dark version that can't be used is a problem", async () => {
    expect((await page(`![A harbour](/assets/images/photo.jpg)\n`)).html).not.toContain("<picture");
    const own = await page(`![Dark sales](/assets/images/chart-dark.png)\n`);
    expect(own.html).not.toContain("<picture");
    expect(own.html).toContain(`src="/_pd/images/chart-dark.ksite.960.webp"`);
    const r = await page(`![At night](/assets/images/night.jpg)\n`);
    expect(r.problems).toEqual([`1: the image /assets/images/night.jpg: its dark version /assets/images/night-dark.jpg can't be used: `
      + `it is not an image sharp can read (test)`]);
  });

  it("an empty or blank alt is a problem at its line, for any image, and says how a decorative image goes in", async () => {
    const r = await page(`# Title\n\nSome text,\nmore text ![](/assets/images/photo.jpg)\n\n![  ](https://example.com/x.png)\n`, { lineOffset: 3 });
    const why = `has no alt text: write what it shows between the brackets; a decorative image goes in through a component, with alt=""`;
    expect(r.problems).toEqual([
      `7: the image /assets/images/photo.jpg ${why}`,
      `9: the image https://example.com/x.png ${why}`,
    ]);
  });

  it("a raster on a page whose layout declares no slot is a problem naming the layout and the key", async () => {
    const r = await page(`![A harbour](/assets/images/photo.jpg)\n`, { slot: undefined });
    expect(r.problems).toEqual([
      `1: the image /assets/images/photo.jpg needs its layout's slot for prose images: layouts/page declares no x-pd-prose-images`,
    ]);
  });

  it("a raster on a page whose layout's slot is invalid says so, with what is wrong", async () => {
    const r = await page(`![A harbour](/assets/images/photo.jpg)\n`, { slot: undefined, slotProblem: "widths must ascend" });
    expect(r.problems).toEqual([
      `1: the image /assets/images/photo.jpg needs its layout's slot for prose images: layouts/page has an invalid x-pd-prose-images (widths must ascend)`,
    ]);
  });

  it("a path the assets don't have, and an image that can't be encoded, are problems", async () => {
    const r = await page(`![Gone](/assets/images/gone.jpg)\n\n![Broken](/assets/images/broken.jpg)\n`);
    expect(r.problems).toEqual([
      `1: the image /assets/images/gone.jpg is not an image in the assets`,
      `3: the image /assets/images/broken.jpg: sharp could not be loaded (test)`,
    ]);
  });

  it("leaves a remote image as markdown writes it", async () => {
    const r = await page(`![Remote](https://example.com/x.png)\n`);
    expect(r.problems).toEqual([]);
    expect(r.html).toBe(`<p><img src="https://example.com/x.png" alt="Remote"></p>\n`);
  });

  it("the workbench's docs (inline mode) write every image as markdown does, and check nothing", async () => {
    const html = await renderDoc(`![](/assets/images/photo.jpg)\n`, async () => "", new Map() as DiscoveryMap);
    expect(html).toBe(`<p><img src="/assets/images/photo.jpg" alt=""></p>\n`);
  });
});
