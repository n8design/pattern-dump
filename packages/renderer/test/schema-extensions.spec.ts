// The placement schema extensions, checked (schema-extensions.ts): each rule once, a valid schema, the
// template rule (only for a schema that uses them), and render() reporting a broken schema as
// SCHEMA_INVALID, so it shows on its component before any page places it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { checkSchemaExtensions, createRenderer, readExampleHeight, readPreviewMode, readProseSlot } from "../src/index";
import { save } from "../../../test-support/save.js";

const ctx = {
  componentExists: (id: string) => ["atoms/slide", "atoms/plain"].includes(id),
  hasSchema: (id: string) => id === "atoms/slide",
};
const check = (schema: unknown, template?: string) => checkSchemaExtensions(schema, template, ctx).map(p => `${p.path}: ${p.message}`);

describe("the placement schema extensions", () => {
  it("pass a schema that uses them as declared", () => {
    expect(check({
      "x-pd-content": "caption",
      properties: {
        caption: { type: "string", contentMediaType: "text/markdown" },
        slides: { type: "array", items: { "x-pd-component": "atoms/slide" } },
        meta: { type: "object", properties: { note: { type: "string", contentMediaType: "text/markdown" } } },
        "x-other": { type: "string" }, // other x- keys are left alone
      },
      "x-vendor": true,
    }, `<p>{{{caption}}}</p><p>{{{note}}}</p><p>{{slides}}</p>`)).toEqual([]);
  });

  it("x-pd-component: names a component that exists and has a schema", () => {
    expect(check({ properties: {
      a: { "x-pd-component": "atoms/nope" },
      b: { type: "array", items: { "x-pd-component": "atoms/plain" } },
      c: { "x-pd-component": 3 },
    } })).toEqual([
      `#/properties/a/x-pd-component: x-pd-component names "atoms/nope", which is not a component`,
      `#/properties/b/items/x-pd-component: x-pd-component names "atoms/plain", which has no schema, so it cannot be placed with values`,
      `#/properties/c/x-pd-component: x-pd-component must name a component`,
    ]);
  });

  it("x-pd-content: names a declared string property", () => {
    expect(check({ "x-pd-content": "body", properties: { text: { type: "string" } } }))
      .toEqual([`#/x-pd-content: x-pd-content names "body", which is not a declared property`]);
    expect(check({ "x-pd-content": "count", properties: { count: { type: "integer" } } }))
      .toEqual([`#/x-pd-content: x-pd-content names "count", which is not a string`]);
  });

  it("contentMediaType: only text/markdown, only on a string", () => {
    expect(check({ properties: { a: { type: "string", contentMediaType: "text/html" }, b: { type: "integer", contentMediaType: "text/markdown" } } })).toEqual([
      `#/properties/a/contentMediaType: contentMediaType must be "text/markdown" (got "text/html")`,
      `#/properties/b/contentMediaType: contentMediaType is only for a string property`,
    ]);
  });

  it("an unknown x-pd- key is an error, at the top and in a property", () => {
    expect(check({ "x-pd-contnet": "caption", properties: { caption: { type: "string", "x-pd-componnet": "atoms/slide" } } })).toEqual([
      `#/x-pd-contnet: "x-pd-contnet" is not a schema extension Pattern Dump knows (x-pd-card, x-pd-component, x-pd-content, x-pd-example-height, x-pd-image, x-pd-preview, x-pd-prose-images, x-pd-query, x-pd-region, x-pd-regions, x-pd-toc, x-pd-view)`,
      `#/properties/caption/x-pd-componnet: "x-pd-componnet" is not a schema extension Pattern Dump knows (x-pd-card, x-pd-component, x-pd-content, x-pd-example-height, x-pd-image, x-pd-preview, x-pd-prose-images, x-pd-query, x-pd-region, x-pd-regions, x-pd-toc, x-pd-view)`,
    ]);
  });

  it("x-pd-preview: \"full\" or \"centered\", at a schema's top", () => {
    expect(check({ "x-pd-preview": "full" })).toEqual([]);
    expect(check({ "x-pd-preview": "centered" })).toEqual([]);
    expect(readPreviewMode({ "x-pd-preview": "full" })).toEqual({ mode: "full" });
    expect(readPreviewMode({ "x-pd-preview": "centered" })).toEqual({ mode: "centered" });
    expect(readPreviewMode({ properties: {} })).toEqual({});
    for (const [value, got] of [["Full", `"Full"`], [true, "true"], [null, "null"], ["fullscreen", `"fullscreen"`]] as const) {
      const message = `x-pd-preview must be "full" or "centered" (got ${got})`;
      expect(check({ "x-pd-preview": value })).toEqual([`#/x-pd-preview: ${message}`]);
      expect(readPreviewMode({ "x-pd-preview": value })).toEqual({ problem: message });
    }
    // In a property it is not a known key.
    expect(check({ properties: { a: { type: "string", "x-pd-preview": "full" } } })[0]).toMatch(/^#\/properties\/a\/x-pd-preview: "x-pd-preview" is not a schema extension/);
  });

  it("x-pd-example-height: a whole number of pixels above 0, at a schema's top", () => {
    expect(check({ "x-pd-example-height": 112, properties: { text: { type: "string" } } })).toEqual([]);
    expect(readExampleHeight({ "x-pd-example-height": 112 })).toEqual({ height: 112 });
    expect(readExampleHeight({ properties: {} })).toEqual({});
    const wording = (got: string) => `#/x-pd-example-height: x-pd-example-height must be a whole number of pixels above 0 (got ${got}): `
      + `the live example's height at the widest column, no taller than its shortest variant`;
    for (const [value, got] of [[0, "0"], [-4, "-4"], [112.5, "112.5"], ["112", `"112"`], [null, "null"]] as const) {
      expect(check({ "x-pd-example-height": value })).toEqual([wording(got)]);
      expect(readExampleHeight({ "x-pd-example-height": value }).problem).toBe(wording(got).slice("#/x-pd-example-height: ".length));
    }
    // In a property it is not a known key.
    expect(check({ properties: { a: { type: "string", "x-pd-example-height": 10 } } })).toEqual([
      `#/properties/a/x-pd-example-height: "x-pd-example-height" is not a schema extension Pattern Dump knows (x-pd-card, x-pd-component, x-pd-content, x-pd-example-height, x-pd-image, x-pd-preview, x-pd-prose-images, x-pd-query, x-pd-region, x-pd-regions, x-pd-toc, x-pd-view)`,
    ]);
  });

  it("x-pd-prose-images: a layout's slot for the images in its pages' prose, at a schema's top", () => {
    const slot = { widths: [480, 960], sizes: "(min-width: 60rem) 40rem, 100vw" };
    expect(check({ "x-pd-prose-images": { ...slot, eager: 1 }, properties: { title: { type: "string" } } })).toEqual([]);
    expect(readProseSlot({ "x-pd-prose-images": { ...slot, eager: 1 } })).toEqual({ slot: { ...slot, eager: 1 } });
    // eager is optional: no image of the page loads at once.
    expect(readProseSlot({ "x-pd-prose-images": slot })).toEqual({ slot: { ...slot, eager: 0 } });
    expect(readProseSlot({ properties: {} })).toEqual({});
    const wording = `#/x-pd-prose-images: x-pd-prose-images must be { "widths": [...], "sizes": "...", "eager": n }: `
      + `widths whole numbers above 0 in ascending order, sizes the <img> sizes value (with no double quote), `
      + `eager (optional) how many of a page's first images load at once, a whole number from 0`;
    for (const value of [
      { widths: [960, 480], sizes: "100vw" }, { widths: [], sizes: "100vw" }, { widths: [480], sizes: "" },
      { widths: [480], sizes: 'a"b' }, { widths: [480], sizes: "100vw", eager: -1 }, { widths: [480], sizes: "100vw", eager: 1.5 },
      { widths: [480], sizes: "100vw", eager: "1" }, { widths: [480], sizes: "100vw", lazy: true }, "480", null,
    ]) {
      expect(check({ "x-pd-prose-images": value })).toEqual([wording]);
      expect(readProseSlot({ "x-pd-prose-images": value }).problem).toBe(wording.slice("#/x-pd-prose-images: ".length));
    }
    // In a property it is not a known key.
    expect(check({ properties: { body: { type: "string", "x-pd-prose-images": slot } } })).toEqual([
      `#/properties/body/x-pd-prose-images: "x-pd-prose-images" is not a schema extension Pattern Dump knows (x-pd-card, x-pd-component, x-pd-content, x-pd-example-height, x-pd-image, x-pd-preview, x-pd-prose-images, x-pd-query, x-pd-region, x-pd-regions, x-pd-toc, x-pd-view)`,
    ]);
  });

  it("x-pd-prose-images doesn't make a layout placeable: its template is not checked", () => {
    expect(check({ "x-pd-prose-images": { widths: [480], sizes: "100vw" }, properties: { body: { type: "string" } } }, `<main>{{{body}}}</main>`)).toEqual([]);
  });

  it("x-pd-card: on a list (a layout's page.children, a view's entries), names a component that exists and has a schema", () => {
    expect(check({ properties: {
      entries: { type: "array", "x-pd-card": "atoms/slide" },
      page: { type: "object", properties: { children: { "x-pd-card": "atoms/slide" } } },
    } })).toEqual([]);
    expect(check({ properties: {
      a: { type: "array", "x-pd-card": "atoms/nope" },
      b: { type: "array", "x-pd-card": "atoms/plain" },
      c: { type: "array", "x-pd-card": 3 },
      d: { type: "string", "x-pd-card": "atoms/slide" },
    } })).toEqual([
      `#/properties/a/x-pd-card: x-pd-card names "atoms/nope", which is not a component`,
      `#/properties/b/x-pd-card: x-pd-card names "atoms/plain", which has no schema, so a listing's pages can't be checked against it`,
      `#/properties/c/x-pd-card: x-pd-card must name a component`,
      `#/properties/d/x-pd-card: x-pd-card is only for a list: the pages of a listing, each shown as the card`,
    ]);
  });

  it("x-pd-query: on a sub-key of a layout's page, an object of known options; its view is a view", () => {
    const views = { componentExists: (id: string) => ["views/compact", "atoms/slide"].includes(id), hasSchema: () => true };
    const run = (schema: unknown) => checkSchemaExtensions(schema, undefined, views).map(p => `${p.path}: ${p.message}`);
    expect(run({ properties: { page: { properties: {
      related: { "x-pd-query": { collections: "same", sort: "relevance", limit: 3, view: "compact" } },
      listing: { "x-pd-view": "compact" },
    } } } })).toEqual([]);
    expect(run({ properties: { page: { properties: {
      a: { "x-pd-query": "same" },
      b: { "x-pd-query": { limt: 3, view: "grid" } },
      listing: { "x-pd-view": "gird" },
      c: { "x-pd-view": 3 },
    } } } })).toEqual([
      `#/properties/page/properties/a/x-pd-query: x-pd-query must be an object of options (pages, collections, categories, tags, match, sort, order, limit, view)`,
      `#/properties/page/properties/b/x-pd-query: "limt" is not an option of a query (pages, collections, categories, tags, match, sort, order, limit, view)`,
      `#/properties/page/properties/b/x-pd-query: view "grid" is not a view (a component in views/)`,
      `#/properties/page/properties/listing/x-pd-view: view "gird" is not a view (a component in views/)`,
      `#/properties/page/properties/c/x-pd-view: x-pd-view must name a view`,
    ]);
  });

  it("x-pd-query doesn't make a layout placeable: its template is not checked", () => {
    expect(check({ properties: { body: { type: "string" }, page: { properties: { related: { "x-pd-query": { limit: 3 } } } } } }, `<main>{{{body}}}{{{page.related.listing}}}</main>`)).toEqual([]);
  });

  it("x-pd-card doesn't make a layout placeable: its template is not checked", () => {
    expect(check({ properties: { body: { type: "string" }, page: { properties: { children: { "x-pd-card": "atoms/slide" } } } } }, `<main>{{{body}}}</main>`)).toEqual([]);
  });

  it("x-pd-example-height doesn't make a component placeable: its template is not checked", () => {
    expect(check({ "x-pd-example-height": 80, properties: { body: { type: "string" } } }, `<main>{{{body}}}</main>`)).toEqual([]);
  });

  it("the template of a schema that uses them outputs unescaped only its text/markdown properties", () => {
    const schema = { "x-pd-content": "caption", properties: { caption: { type: "string", contentMediaType: "text/markdown" }, credit: { type: "string" } } };
    expect(check(schema, `<p>{{{caption}}}</p>\n<small>{{{credit}}}</small>{{{shout credit}}}`)).toEqual([
      `#: the template outputs "credit" ({{{credit}}}) unescaped at 2:8, which only a text/markdown property may be`,
      `#: the template outputs a helper's result ({{{shout …}}}) unescaped at 2:28, which only a text/markdown property may be`,
    ]);
    // A schema without placement extensions is not placeable: its template's {{{body}}} is its own affair.
    expect(check({ properties: { body: { type: "string" } } }, `<main>{{{body}}}</main>`)).toEqual([]);
  });
});

describe("render()", () => {
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pd-schema-ext-"));
    for (const [rel, text] of Object.entries({
      "atoms/bad/bad.hbs": `<p>{{{text}}}</p>\n`,
      "atoms/bad/bad.schema.json": JSON.stringify({ "x-pd-content": "text", properties: { text: { type: "string" } } }),
    })) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await save(join(root, rel), text);
    }
  });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("reports a component's broken schema as SCHEMA_INVALID, naming the schema file", async () => {
    const { discoveryMap, handleMap } = await buildDiscoveryMap(root);
    const render = createRenderer({ patternsDir: root, discoveryMap, handleMap });
    const r = await render({ component: "atoms/bad" });
    expect(r.meta?.diagnostics?.filter(d => d.kind === "SCHEMA_INVALID")).toEqual([{
      kind: "SCHEMA_INVALID", severity: "error", source: "schema", path: "#",
      message: `the template outputs "text" ({{{text}}}) unescaped at 1:4, which only a text/markdown property may be`,
      location: { file: "atoms/bad/bad.schema.json" },
    }]);
  });
});
