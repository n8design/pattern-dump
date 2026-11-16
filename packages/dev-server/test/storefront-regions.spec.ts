// Regions (regions.ts) and the table of contents (toc.ts): a layout's regions on page.regions, placed components that
// go into one (by region="..." or their schema's x-pd-region), in the page's order; a region of another layout left
// out; a typo, a reserved landmark and a landmark brought into a region failing the page; data-pd-regions on <body>;
// toc: true / false, a layout's x-pd-toc, and <pd-toc> with derived or custom links.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderInput } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { readPages } from "../src/storefront/pages.js";
import { buildCompositionRegistry } from "../src/composition.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { layoutRegions, regionLandmarks, RESERVED_REGIONS } from "../src/storefront/regions.js";
import { save } from "../../../test-support/save.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); });

const schema = (props: Record<string, unknown>, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "object", ...extra, properties: props });
const DOC = "<main><h1>{{title}}</h1>{{{body}}}</main>{{#if page.regions.sidebar}}<aside class=\"side\">{{{page.regions.sidebar}}}</aside>{{/if}}";
const DOC_SCHEMA = (regions: Record<string, unknown> = { "x-pd-regions": ["sidebar"] }) =>
  schema({ title: { type: "string" }, page: { type: "object", properties: { regions } } });

const PATTERNS: Record<string, string> = {
  "layouts/doc/doc.hbs": DOC,
  "layouts/doc/doc.schema.json": DOC_SCHEMA(),
  "layouts/page/page.hbs": "<main><h1>{{title}}</h1>{{{body}}}</main>",
  "layouts/page/page.schema.json": schema({ title: { type: "string" } }),
  // Another layout's region: "aside".
  "layouts/wide/wide.hbs": "<main><h1>{{title}}</h1>{{{body}}}</main>{{{page.regions.aside}}}",
  "layouts/wide/wide.schema.json": DOC_SCHEMA({ "x-pd-regions": ["aside"] }),
  "components/box/box.hbs": "<div class=\"box\">{{label}}</div>",
  "components/box/box.schema.json": schema({ label: { type: "string" } }, { required: ["label"] }),
  "components/note/note.hbs": "<p class=\"note\">{{text}}</p>",
  "components/note/note.schema.json": schema({ text: { type: "string" } }, { "x-pd-region": "sidebar" }),
  "components/toc/toc.hbs": "<nav class=\"toc\" aria-label=\"On this page\"><ul>{{#each items}}<li class=\"l{{level}}\"><a href=\"{{href}}\">{{text}}</a></li>{{/each}}</ul></nav>",
  "components/toc/toc.schema.json": schema({ items: { type: "array", items: { type: "object", properties: { text: {}, href: {}, level: {} } } } }, { "x-pd-region": "sidebar" }),
};

async function site(files: Record<string, string>, patterns: Record<string, string | null> = {}) {
  const root = await mkdtemp(join(tmpdir(), "pd-regions-"));
  roots.push(root);
  const dir = join(root, "patterns");
  for (const [rel, body] of Object.entries({ ...PATTERNS, ...patterns })) if (body !== null) await save(join(dir, ...rel.split("/")), body);
  for (const [rel, body] of Object.entries(files)) await save(join(root, "pages", ...rel.split("/")), body);
  const { discoveryMap, handleMap } = await buildDiscoveryMap(dir);
  const render = createRenderer({ patternsDir: dir, discoveryMap, handleMap });
  const model = await readPages(join(root, "pages"), { drafts: "leave-out", scheduled: "leave-out", today: "2026-11-16" });
  const composition = await buildCompositionRegistry(dir, handleMap, discoveryMap);
  return async (route: string) => {
    const inputs: RenderInput[] = [];
    const p = await assemblePage(route, model, {
      discoveryMap, handleMap, composition, site: undefined, workbenchUrl: "https://wb.example/", shown: x => x, head: async () => "",
      image: async () => ({ ok: false, message: "no images here" }), render: input => { inputs.push(input); return render(input); },
    } as PageAssembly);
    const data = inputs.find(i => i.component.startsWith("layouts/"))?.data as { page?: Record<string, unknown> } | undefined;
    return { ...p, regions: data?.page?.["regions"] as Record<string, string | null> | undefined };
  };
}
const page = (front: string, body: string) => `---\ntitle: T\n${front}---\n\n${body}\n`;
const bodyOf = (html: string) => /<body[^>]*>/.exec(html)?.[0];

describe("a layout's regions", () => {
  it("are page.regions' x-pd-regions; a reserved name, a bad name, a repeat and other keys are problems", () => {
    expect(layoutRegions(JSON.parse(DOC_SCHEMA({ "x-pd-regions": ["sidebar", "aside"], "x-pd-toc": true })), "layouts/doc"))
      .toEqual({ regions: ["sidebar", "aside"], toc: true, problems: [] });
    expect(layoutRegions(JSON.parse(DOC_SCHEMA({ "x-pd-regions": ["header", "Side bar", "aside", "aside"], "x-pd-toc": "yes", sidebar: {} })), "layouts/doc").problems).toEqual([
      `layouts/doc (page.regions): header is reserved for the layout's own landmark: write it in the layout, and name the region otherwise`,
      `layouts/doc (page.regions): "Side bar" is not a region name: lowercase letters, digits and hyphens, starting with a letter`,
      `layouts/doc (page.regions): "aside" is listed twice`,
      `layouts/doc (page.regions): "x-pd-toc" is true or false`,
      `layouts/doc (page.regions): "sidebar": page.regions declares only "x-pd-regions" and "x-pd-toc" (the regions' shape is Pattern Dump's)`,
    ]);
    expect(RESERVED_REGIONS).toEqual(["header", "footer", "nav", "main"]);
  });

  it("a layout that declares a reserved one fails its pages", async () => {
    const assemble = await site({ "index.md": page("layout: doc\n", "Text.") }, { "layouts/doc/doc.schema.json": DOC_SCHEMA({ "x-pd-regions": ["footer"] }) });
    expect((await assemble("/")).problems).toContain(`layouts/doc (page.regions): footer is reserved for the layout's own landmark: write it in the layout, and name the region otherwise`);
  });
});

describe("components in a region", () => {
  it("go there by region= or their default, in the page's order; the rest stay in the body; <body> says what is filled", async () => {
    const assemble = await site({ "index.md": page("layout: doc\n",
      `Text.\n\n<pd-components-box label="First" region="sidebar"></pd-components-box>\n\n<pd-components-note text="Second"></pd-components-note>\n\n<pd-components-box label="Inline"></pd-components-box>\n`) });
    const p = await assemble("/");
    expect(p.problems).toEqual([]);
    expect(p.regions).toEqual({ sidebar: `<div class="box">First</div>\n<p class="note">Second</p>` });
    expect(p.html).toContain(`<aside class="side"><div class="box">First</div>\n<p class="note">Second</p></aside>`);
    expect(p.html).toMatch(/<main><h1>T<\/h1><p>Text.<\/p>\n<div class="box">Inline<\/div>\n<\/main>/);
    expect(bodyOf(p.html)).toBe(`<body data-pd-regions="sidebar">`);
  });

  it("a page with nothing for a region: null, so the layout leaves it out, and <body> names none", async () => {
    const p = await (await site({ "index.md": page("layout: doc\n", "Text.") }))("/");
    expect(p.problems).toEqual([]);
    expect(p.regions).toEqual({ sidebar: null });
    expect(p.html).not.toContain(`class="side"`);
    expect(bodyOf(p.html)).toBe(`<body data-pd-regions="">`);
    // A layout without regions: no attribute.
    const plain = await (await site({ "index.md": page("", "Text.") }))("/");
    expect(bodyOf(plain.html)).toBe("<body>");
  });

  it("a region of another layout: left out without a message, and still checked against its schema", async () => {
    const assemble = await site({
      "index.md": page("layout: doc\n", `<pd-components-box label="Gone" region="aside"></pd-components-box>`),
      "about.md": page("layout: doc\n", `<pd-components-box region="aside"></pd-components-box>`),
    });
    const p = await assemble("/");
    expect(p.problems).toEqual([]);
    expect(p.html).not.toContain("Gone");
    expect((await assemble("/about/")).problems).toEqual([expect.stringMatching(/^about\.md:6:1: .*label/)]);
  });

  it("a region no layout has fails with a did-you-mean; a reserved one says it is the layout's, with what the layout offers", async () => {
    const assemble = await site({
      "index.md": page("layout: doc\n", `<pd-components-box label="A" region="sidebr"></pd-components-box>`),
      "about.md": page("layout: doc\n", `<pd-components-box label="A" region="header"></pd-components-box>`),
      "more.md": page("layout: doc\n", `<pd-components-note text="A"></pd-components-note>`),
    }, { "components/note/note.schema.json": schema({ text: { type: "string" } }, { "x-pd-region": "footer" }) });
    expect((await assemble("/")).problems).toEqual([`index.md:6:1: <pd-components-box region="sidebr">: region "sidebr" is no layout's region: did you mean "sidebar"? `
      + `(the skin's regions are "aside", "sidebar")`]);
    expect((await assemble("/about/")).problems).toEqual([`about.md:6:1: <pd-components-box region="header">: the header belongs to the layout, so no component goes into it `
      + `(layouts/doc offers "sidebar")`]);
    expect((await assemble("/more/")).problems).toEqual([`more.md:6:1: <pd-components-note> (components/note's default region, x-pd-region): the footer belongs to the layout, `
      + `so no component goes into it (layouts/doc offers "sidebar")`]);
  });

  it("a component that would bring a landmark into a region fails the page", async () => {
    const assemble = await site({ "index.md": page("layout: doc\n", `<pd-components-box label="A" region="sidebar"></pd-components-box>`) },
      { "components/box/box.hbs": "<header><p>{{label}}</p></header><article><header>Fine</header></article>" });
    expect((await assemble("/")).problems).toEqual([`index.md:6:1: <pd-components-box region="sidebar">: what it renders would bring a banner `
      + `(a <header> outside article, aside, nav and section) into the region "sidebar": the page's landmarks are the layout's`]);
    expect(regionLandmarks(`<main>x</main><div role="contentinfo"></div><aside><footer>ok</footer></aside><footer>no</footer>`))
      .toEqual(["a main landmark", "a contentinfo (a <footer> outside article, aside, nav and section)"]);
  });

  it("region= on a component that declares a property region is named", async () => {
    const assemble = await site({ "index.md": page("layout: doc\n", `<pd-components-box label="A" region="sidebar"></pd-components-box>`) },
      { "components/box/box.schema.json": schema({ label: { type: "string" }, region: { type: "string" } }) });
    expect((await assemble("/")).problems).toEqual([`index.md:6:30: <pd-components-box>: region="..." is Pattern Dump's (the layout's region the component goes into), `
      + `and components/box declares a property "region" as well: rename that property to place it in a region`]);
  });
});

const HEADED = "## Install\n\nText.\n\n### Options\n\nMore.\n\n#### Deep\n\nDeeper.\n";

describe("the table of contents", () => {
  it("toc: true: the derived items (levels 2 and 3) first in components/toc's region", async () => {
    const assemble = await site({ "index.md": page("layout: doc\ntoc: true\n", `${HEADED}\n<pd-components-note text="After"></pd-components-note>`) });
    const p = await assemble("/");
    expect(p.problems).toEqual([]);
    expect(p.regions?.["sidebar"]).toBe(`<nav class="toc" aria-label="On this page"><ul><li class="l2"><a href="#install">Install</a></li>`
      + `<li class="l3"><a href="#options">Options</a></li></ul></nav>\n<p class="note">After</p>`);
  });

  it("a layout's x-pd-toc shows it by default; toc: false keeps it out; a page with no heading for it gets none", async () => {
    const assemble = await site({
      "index.md": page("layout: doc\n", HEADED),
      "about.md": page("layout: doc\ntoc: false\n", HEADED),
      "flat.md": page("layout: doc\n", "No headings."),
      "bad.md": page("layout: doc\ntoc: yes\n", HEADED),
    }, { "layouts/doc/doc.schema.json": DOC_SCHEMA({ "x-pd-regions": ["sidebar"], "x-pd-toc": true }) });
    expect((await assemble("/")).regions?.["sidebar"]).toContain(`<nav class="toc"`);
    expect((await assemble("/about/")).regions).toEqual({ sidebar: null });
    expect((await assemble("/flat/")).regions).toEqual({ sidebar: null });
    expect((await assemble("/bad/")).problems).toEqual([expect.stringContaining("toc must be true or false")]);
  });

  it("<pd-toc>'s #anchor to a heading suffixed because the layout has its id is the suffixed one", async () => {
    const assemble = await site({ "index.md": page("layout: doc\n", "## Side\n\nText.\n\n<pd-toc>\n- [Side](#side-1)\n</pd-toc>\n") },
      { "layouts/doc/doc.hbs": DOC.replace(`<aside class="side">`, `<aside class="side" id="side">`) });
    const p = await assemble("/");
    expect(p.problems).toEqual([]);
    expect(p.html).toContain(`<h2 id="side-1">Side</h2>`);
    expect(p.html).toContain(`<a href="#side-1">Side</a>`);
  });

  it("<pd-toc>: where it is, with the derived items, or with its own links; no derived one besides", async () => {
    const assemble = await site({
      "index.md": page("layout: doc\ntoc: true\n", `<pd-toc></pd-toc>\n\n${HEADED}`),
      "about.md": page("layout: doc\n", `${HEADED}\n<pd-toc>\n- [Start here](#install)\n  - [The options](#options)\n- [Home](/)\n</pd-toc>\n`),
      "inline.md": page("layout: doc\n", `<pd-toc region="aside"></pd-toc>\n\n${HEADED}`),
    });
    const derived = await assemble("/");
    expect(derived.problems).toEqual([]);
    expect(derived.regions?.["sidebar"]?.match(/<nav/g)).toHaveLength(1);
    const own = await assemble("/about/");
    expect(own.problems).toEqual([]);
    expect(own.regions?.["sidebar"]).toBe(`<nav class="toc" aria-label="On this page"><ul><li class="l2"><a href="#install">Start here</a></li>`
      + `<li class="l3"><a href="#options">The options</a></li><li class="l2"><a href="/">Home</a></li></ul></nav>`);
    // Another layout's region: left out.
    expect((await assemble("/inline/")).html).not.toContain(`class="toc"`);
  });

  it("<pd-toc>'s links are checked: one link per item, and an #anchor is a heading of the page", async () => {
    const assemble = await site({
      "index.md": page("layout: doc\n", `${HEADED}\n<pd-toc>\n- [Install](#install)\n- [Configure](#instal)\n</pd-toc>\n`),
      "about.md": page("layout: doc\n", `${HEADED}\n<pd-toc>\n- [Install](#install)\n- Just text\n</pd-toc>\n`),
    });
    expect((await assemble("/")).problems).toEqual([`index.md:20:1: <pd-toc>: #instal is no heading of this page: did you mean "#install"?`]);
    expect((await assemble("/about/")).problems).toEqual([`about.md:20:1: <pd-toc>: "Just text" is not one link: write each item as "[text](#anchor)"`]);
  });

  it("without components/toc, asking for it is a problem naming it", async () => {
    const assemble = await site({ "index.md": page("layout: doc\ntoc: true\n", HEADED) }, { "components/toc/toc.hbs": null, "components/toc/toc.schema.json": null });
    expect((await assemble("/")).problems).toEqual([`index.md:4:1: toc: true places the table of contents, which is the skin's components/toc, `
      + `and the skin has none: add it (it gets items: [{ text, href, level }])`]);
  });
});
