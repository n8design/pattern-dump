// Nothing a page writes in a pd- tag reaches the page as HTML. An attribute value is plain text, escaped
// by the template; content becomes HTML only as block markdown with html: false (a text/markdown property),
// before the template outputs it with triple-stash; and a template that outputs a plain value with
// triple-stash is refused with a named error, nothing rendered. Through the real renderer and templates.
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

const FILES: Record<string, string> = {
  "molecules/slider/slider.hbs": `<ul class="slider">{{#each slides}}<li>{{> atoms-slide}}</li>{{/each}}</ul>\n`,
  "molecules/slider/slider.schema.json": JSON.stringify({ required: ["slides"], properties: { slides: { type: "array", items: { "x-pd-component": "atoms/slide" } } } }),
  "atoms/slide/slide.hbs": `<figure><img src="{{image}}" alt="{{alt}}">{{#if caption}}<figcaption>{{{caption}}}</figcaption>{{/if}}</figure>\n`,
  "atoms/slide/slide.schema.json": JSON.stringify({ "x-pd-content": "caption", required: ["image", "alt"], properties: {
    image: { type: "string" }, alt: { type: "string" }, caption: { type: "string", contentMediaType: "text/markdown" } } }),
  "atoms/loud/loud.hbs": `<figure><img src="{{image}}" alt="{{alt}}"><small>{{{credit}}}</small></figure>\n`,
  "atoms/loud/loud.schema.json": JSON.stringify({ required: ["image", "alt"], properties: { image: { type: "string" }, alt: { type: "string" }, credit: { type: "string" } } }),
};
const ATTR = `x&quot; onerror=&quot;alert(1)`; // as written in the page: x" onerror="alert(1)
const SCRIPT = `<script>alert(1)</script>`;

let root = "";
let deps: PlacementDeps;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-placed-escaping-"));
  for (const [rel, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), text);
  }
  const { discoveryMap, handleMap } = await buildDiscoveryMap(root);
  deps = {
    discoveryMap, handleMap,
    composition: await buildCompositionRegistry(root, handleMap, discoveryMap),
    render: createRenderer({ patternsDir: root, discoveryMap, handleMap }),
    schemaOf: async id => (await readSchema(discoveryMap.get(id)?.schemaPath)).schema,
    shown: path => relative(root, path),
  };
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const place = async (body: string) => {
  const [block] = readPlacedBlocks(body);
  const r = await placeBlock(block, deps);
  return { html: r.html, problems: r.problems.map(p => `${p.at.line}:${p.at.column} ${p.message}`) };
};

describe("a payload in a placed component", () => {
  it("in an attribute and in markdown content: escaped, never live HTML", async () => {
    const r = await place(
      `<pd-molecules-slider>\n  <pd-atoms-slide image="a.jpg" alt='"><script>alert(1)</script>${ATTR.replace(/&quot;/g, '"')}'>\n`
      + `    ${SCRIPT} <img src=x onerror=alert(1)> [link](javascript:alert(1)) **bold**\n  </pd-atoms-slide>\n</pd-molecules-slider>\n`,
    );
    expect(r.problems).toEqual([]);
    const html = r.html!;
    // The attribute: escaped by {{alt}}, so its quote cannot end the attribute.
    expect(html).toContain(`alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;x&quot; onerror&#x3D;&quot;alert(1)"`);
    // The content: markdown with html: false, so the tags are text; the javascript: link is not a link.
    expect(html).toContain("<figcaption><p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt; [link](javascript:alert(1)) <strong>bold</strong></p>\n</figcaption>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img[^>]*\sonerror=/i);
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("through a template that outputs a plain value with triple-stash: a named error, nothing rendered", async () => {
    const r = await place(`<pd-atoms-loud image="a.jpg" alt="a" credit="${SCRIPT}"></pd-atoms-loud>\n`);
    expect(r.html).toBeUndefined();
    expect(r.problems).toEqual([
      `1:1 atoms/loud outputs "credit" unescaped ({{{credit}}}) at atoms/loud/loud.hbs:1:51, which only a text/markdown property may be`,
    ]);
  });
});
