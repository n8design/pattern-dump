// Sample data never reaches a page through a placed component: it renders without sample data (its own, an included
// partial's, at any depth), and declared keys the page does not set are null. A sample key a component does not
// declare is no problem (it was, before 0.8.1, as the guard against the leak). Through the real renderer, so the
// cascade is the real one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPlacedBlocks } from "../src/placed-tags.js";
import { readSchema } from "../src/storefront/declared-values.js";
import { placeBlock, type PlacementDeps } from "../src/storefront/placed.js";
import { save } from "../../../test-support/save.js";

const json = (v: unknown) => JSON.stringify(v);
const FILES: Record<string, string> = {
  // A slider of slides, each with a credit; the slider includes a badge partial with its own context.
  "molecules/slider/slider.hbs": `<ul data-n="{{perView}}">{{> atoms-badge}}{{#each slides}}<li>{{> atoms-slide}}</li>{{/each}}</ul>\n`,
  "molecules/slider/slider.json": json({ perView: 9 }),
  "molecules/slider/slider.schema.json": json({ properties: { perView: { type: "integer" }, slides: { type: "array", items: { "x-pd-component": "atoms/slide" } } } }),
  "atoms/slide/slide.hbs": `<figure><img src="{{image}}">{{#if credit}}<small>{{credit}}</small>{{/if}}</figure>\n`,
  "atoms/slide/slide.json": json({ image: "sample.jpg", credit: "SAMPLE CREDIT" }),
  "atoms/slide/slide.schema.json": json({ required: ["image"], properties: { image: { type: "string" }, credit: { type: "string" } } }),
  "atoms/badge/badge.hbs": `<b>{{tone}}</b>\n`,
};
const LEAKY: Record<string, string> = {
  "atoms/badge/badge.json": json({ tone: "SAMPLE TONE" }),
  "atoms/slide/slide.json": json({ image: "sample.jpg", credit: "SAMPLE CREDIT", secret: "SAMPLE SECRET" }),
  "molecules/box/box.hbs": `<div>{{meta.owner}}{{meta.secret}}</div>\n`,
  "molecules/box/box.json": json({ meta: { owner: "SAMPLE OWNER", secret: "SAMPLE SECRET" } }),
  "molecules/box/box.schema.json": json({ properties: { meta: { type: "object", properties: { owner: { type: "string" } } } } }),
};

async function project(files: Record<string, string>): Promise<{ root: string; deps: PlacementDeps }> {
  const root = await mkdtemp(join(tmpdir(), "pd-placed-sample-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  const { discoveryMap, handleMap } = await buildDiscoveryMap(root);
  return { root, deps: {
    discoveryMap, handleMap,
    composition: await buildCompositionRegistry(root, handleMap, discoveryMap),
    render: createRenderer({ patternsDir: root, discoveryMap, handleMap }),
    schemaOf: async id => (await readSchema(discoveryMap.get(id)?.schemaPath)).schema,
    shown: path => relative(root, path),
  } };
}
const roots: string[] = [];
let clean: PlacementDeps;
let leaky: PlacementDeps;
beforeAll(async () => {
  const a = await project(FILES); roots.push(a.root); clean = a.deps;
  const b = await project({ ...FILES, ...LEAKY }); roots.push(b.root); leaky = b.deps;
});
afterAll(async () => { for (const r of roots) await rm(r, { recursive: true, force: true }); });

const SLIDER = `<pd-molecules-slider>\n  <pd-atoms-slide image="a.jpg"></pd-atoms-slide>\n</pd-molecules-slider>\n`;
const place = async (deps: PlacementDeps, body: string) => {
  const r = await placeBlock(readPlacedBlocks(body)[0], deps);
  return { html: r.html, problems: r.problems.map(p => p.message) };
};

describe("sample data and a placed component", () => {
  it("reaches the page nowhere: declared keys the page does not set are empty, not the sample's", async () => {
    const r = await place(clean, SLIDER);
    expect(r.problems).toEqual([]);
    expect(r.html).not.toMatch(/SAMPLE|sample\.jpg|data-n="9"/);
    expect(r.html).toContain(`<img src="a.jpg">`);
  });

  it("renders with sample keys a component doesn't declare, and none reaches the page: a partial's, a nested one's, inside an object", async () => {
    const slider = await place(leaky, SLIDER);
    expect(slider.problems).toEqual([]);
    expect(slider.html).not.toMatch(/SAMPLE|sample\.jpg|data-n="9"/);
    const box = await place(leaky, `<pd-molecules-box></pd-molecules-box>\n`);
    expect(box.problems).toEqual([]);
    expect(box.html).not.toMatch(/SAMPLE/);
  });
});
