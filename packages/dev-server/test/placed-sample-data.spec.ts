// Sample data never reaches a page through a placed component. Declared keys are null where the page sets
// none (so a declared sample value cannot fill them), and a sample key a component does not declare is a
// problem: in its own sample, in an included partial's, and one level inside a declared object. Through
// the real renderer, so the cascade is the real one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPlacedBlocks } from "../src/placed-tags.js";
import { readSchema } from "../src/storefront/declared-values.js";
import { placeBlock, type PlacementDeps } from "../src/storefront/placed.js";

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
    await writeFile(join(root, rel), text);
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

  it("is refused where a sample key is not declared: an included partial's, a nested component's, inside a declared object", async () => {
    expect((await place(leaky, SLIDER)).problems).toEqual([
      `the sample data of atoms/badge (badge.json) sets "tone", which molecules/slider does not declare, so it would show wherever molecules/slider is placed`,
      `the sample data of atoms/slide (slide.json) sets "secret", which atoms/slide does not declare, so it would show wherever atoms/slide is placed`,
    ]);
    expect((await place(leaky, `<pd-molecules-box></pd-molecules-box>\n`)).problems).toEqual([
      `the sample data of molecules/box (box.json) sets "meta.secret", which molecules/box does not declare, so it would show wherever molecules/box is placed`,
    ]);
  });
});
