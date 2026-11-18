// `![Alt](#stem)` in markdown (markdown.ts, symbolImages): a symbol on a storefront page (frame mode), a marked error
// in the workbench's docs (inline mode). Fragment links and every other image are left as they were.
import { describe, expect, it } from "vitest";
import type { DiscoveryMap, ImageLookup } from "@pattern-dump/contracts";
import { renderDoc, type ProseImages, type SymbolImages } from "../src/markdown.js";
import { prepareSymbol, type SymbolEntry } from "../src/symbols.js";
import { FLOW, LAYERS } from "./symbol-fixtures.js";

const ENTRIES: Record<string, SymbolEntry> = {
  flow: prepareSymbol("flow", "/p/assets/symbols/flow.svg", FLOW),
  layers: prepareSymbol("layers", "/p/assets/symbols/layers.svg", LAYERS),
  broken: prepareSymbol("broken", "/p/assets/symbols/broken.svg", `<svg viewBox="0 0 1 1"><rect fill="#000"/></svg>`),
};
const FLOW_SVG = `<svg class="doc-image" role="img" aria-label="A filled box points to an outlined box" viewBox="0 0 400 200" width="400" height="200"><use href="#img-flow"/></svg>`;

async function site(body: string, o: { lineOffset?: number; prose?: boolean } = {}) {
  const symbols: SymbolImages = { lookup: stem => ENTRIES[stem], lineOffset: o.lineOffset ?? 0, problems: [], used: [] };
  const lookup: ImageLookup = src => src === "/assets/images/mark.svg" ? { kind: "single", url: src, width: 48, height: 24 } : undefined;
  const prose: ProseImages = { layoutId: "layouts/page", lookup, lineOffset: o.lineOffset ?? 0, problems: [] };
  const html = await renderDoc(body, async () => "", new Map() as DiscoveryMap,
    { embed: "frame", workbenchUrl: "/wb/", problems: [], symbols, ...(o.prose === false ? {} : { prose }) });
  return { html, problems: [...symbols.problems, ...prose.problems].map(p => `${p.line}: ${p.message}`), used: symbols.used.map(s => s.stem) };
}

describe("symbol images on a storefront page", () => {
  it("an image of a symbol is a <use> of the page's sprite at the source's size, named by its alt", async () => {
    const r = await site(`![A filled box points to an outlined box](#flow)\n`);
    expect(r.problems).toEqual([]);
    expect(r.html).toBe(`<p>${FLOW_SVG}</p>\n`);
    expect(r.used).toEqual(["flow"]);
  });

  it("with a title, a figure with its caption, the paragraph gone", async () => {
    const r = await site(`![Two layers](#layers "Layers, captioned")\n`);
    expect(r.html).toBe(`<figure class="doc-figure">\n<svg class="doc-image" role="img" aria-label="Two layers" viewBox="0 0 400 200" `
      + `width="400" height="200"><use href="#img-layers"/></svg>\n<figcaption>Layers, captioned</figcaption>\n</figure>\n`);
  });

  it("each symbol is used once, in the order first drawn; text around an image stays", async () => {
    const r = await site(`![B](#layers) and ![A](#flow)\n\n![A again](#flow)\n`);
    expect(r.used).toEqual(["layers", "flow"]);
    expect(r.html).toContain(` and <svg class="doc-image" role="img" aria-label="A"`);
  });

  it("an empty alt, a stem with no symbol, a broken symbol and a caption in running text are problems at their line", async () => {
    const r = await site(`![](#flow)\n\n![Gone](#nothing)\n\n![Broken](#broken)\n\nText ![Cap](#flow "Caption")\n`, { lineOffset: 3 });
    expect(r.problems).toEqual([
      `4: the image #flow has no alt text: write what it shows between the brackets; a decorative image goes in through a component, with alt=""`,
      `6: the image #nothing is not a symbol: there is no nothing.svg in an asset root's symbols/ folder`,
      expect.stringMatching(/^8: the image #broken: symbols\/broken\.svg can't be used: <rect> fill="#000" is not a colour token/),
      `10: the image #flow: a caption needs the image on a line of its own`,
    ]);
    expect(r.used).toEqual([]);
  });

  it("a fragment link and an image from the assets are as they were", async () => {
    const r = await site(`[jump](#flow) ![A mark](/assets/images/mark.svg)\n`);
    expect(r.html).toBe(`<p><a href="#flow">jump</a> <img src="/assets/images/mark.svg" width="48" height="24" alt="A mark" loading="lazy" decoding="async"></p>\n`);
    expect(r.problems).toEqual([]);
  });

  it("without the image index (no prose images) symbols still render", async () => {
    expect((await site(`![A filled box points to an outlined box](#flow)\n`, { prose: false })).html).toBe(`<p>${FLOW_SVG}</p>\n`);
  });
});

describe("symbol images in the workbench's docs", () => {
  it("are a marked error: a block when alone in a paragraph, in place otherwise", async () => {
    const msg = `[image #flow · symbol images show on site pages only, not in the workbench's docs yet]`;
    expect(await renderDoc(`![A](#flow)\n`, async () => "", new Map())).toBe(`<p class="doc-error">${msg}</p>\n`);
    expect(await renderDoc(`See ![A](#flow).\n`, async () => "", new Map())).toBe(`<p>See <span class="doc-error">${msg}</span>.</p>\n`);
    expect(await renderDoc(`![A](/assets/images/x.svg) [jump](#flow)\n`, async () => "", new Map()))
      .toBe(`<p><img src="/assets/images/x.svg" alt="A"> <a href="#flow">jump</a></p>\n`);
  });
});
