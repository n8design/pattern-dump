// renderDoc in frame mode — the markdown of a storefront page. A `pattern` fence is an iframe on the
// component's own preview document plus a link into the workbench; nothing of the component is rendered
// into the page. `pattern:` links go to the workbench's URL. A missing component is marked in the page
// and reported as a problem. The same parser and the same safety rules as the workbench's docs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { renderDoc, type DocEmbed } from "../src/markdown.js";
import { save } from "../../../test-support/save.js";

const WB = "https://workbench.example.test/";
let map: DiscoveryMap;
let rendered = 0;
/** Frame mode must never render a `pattern` example into the page: this one fails loudly if asked. */
const renderComponent = async (id: string, variant?: string): Promise<string> => {
  rendered++;
  return `<p class="rendered">${id}${variant ? `~${variant}` : ""}</p>`;
};

beforeAll(async () => {
  const bench = fileURLToPath(new URL("../../../storefront-bench/src/patterns/", import.meta.url));
  map = (await buildDiscoveryMap(bench)).discoveryMap;
});

const frame = (problems: string[] = []): DocEmbed => ({ embed: "frame", workbenchUrl: WB, problems });

describe("renderDoc frame mode — pattern fences", () => {
  it("embeds a component as an iframe on its preview, with a link to it in the workbench", async () => {
    rendered = 0;
    const problems: string[] = [];
    const html = await renderDoc("```pattern components/callout\n```\n", renderComponent, map, frame(problems));
    expect(html).toBe(
      `<figure class="doc-example">\n`
      + `<iframe src="/preview/components/callout" title="components/callout" loading="lazy" height="112"></iframe>\n`
      + `<ul class="doc-example-variants" aria-label="Variants of components/callout">\n`
      + `<li><a href="/preview/components/callout" aria-current="true">default</a></li>\n`
      + `<li><a href="/preview/components/callout~warning">warning</a></li>\n`
      + `</ul>\n`
      + `<figcaption><span class="doc-example-id">components/callout</span> <a href="https://workbench.example.test/components/callout">Open components/callout in the workbench</a></figcaption>\n`
      + `</figure>\n`,
    );
    expect(problems).toEqual([]);
    expect(rendered).toBe(0);
  });

  it("addresses a variant by its id, and links to it in the workbench", async () => {
    const html = await renderDoc("```pattern components/callout~warning\n```\n", renderComponent, map, frame());
    expect(html).toContain(`<iframe src="/preview/components/callout~warning" title="components/callout~warning" loading="lazy" height="112"></iframe>`);
    expect(html).toContain(`<a href="https://workbench.example.test/components/callout#warning">Open components/callout~warning in the workbench</a>`);
  });

  it("marks a component or variant that does not exist, and reports it", async () => {
    const problems: string[] = [];
    const html = await renderDoc("```pattern components/nope\n```\n\n```pattern components/callout~nope\n```\n", renderComponent, map, frame(problems));
    expect(html).toBe(
      `<p class="doc-error">[pattern: components/nope — no such component]</p>`
      + `<p class="doc-error">[pattern: components/callout~nope — no such component]</p>`,
    );
    expect(problems).toEqual([
      "pattern components/nope: there is no such component",
      "pattern components/callout~nope: there is no such component",
    ]);
  });

  it("escapes the id in every attribute it bakes", async () => {
    const evil = `x/a"><script>alert(1)</script>`;
    const evilMap = new Map([[evil, { hbsPath: "/x.hbs", ownMarkup: true }]]) as DiscoveryMap;
    const html = await renderDoc("```pattern " + evil + "\n```\n", renderComponent, evilMap, frame());
    expect(html).not.toContain("<script>");
    expect(html).toContain(`src="/preview/x/a&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"`);
  });
});

describe("renderDoc frame mode — a component's variants", () => {
  it("lists every variant from discovery, the base first, each a link to its own preview, the shown one current", async () => {
    const html = await renderDoc("```pattern components/callout~warning\n```\n", renderComponent, map, frame());
    expect(html).toContain(
      `<ul class="doc-example-variants" aria-label="Variants of components/callout">\n`
      + `<li><a href="/preview/components/callout">default</a></li>\n`
      + `<li><a href="/preview/components/callout~warning" aria-current="true">warning</a></li>\n`
      + `</ul>\n`);
  });

  it("names the component it shows in its caption, beside the workbench link", async () => {
    const html = await renderDoc("```pattern components/callout~warning\n```\n", renderComponent, map, frame());
    expect(html).toContain(`<figcaption><span class="doc-example-id">components/callout~warning</span> <a href="https://workbench.example.test/components/callout#warning">Open components/callout~warning in the workbench</a></figcaption>`);
  });

  it("lists nothing for a component without variants", async () => {
    const noVariants: DiscoveryMap = new Map([...map].filter(([id]) => !id.includes("~")));
    const html = await renderDoc("```pattern components/callout\n```\n", renderComponent, noVariants, frame());
    expect(html).toBe(
      `<figure class="doc-example">\n`
      + `<iframe src="/preview/components/callout" title="components/callout" loading="lazy" height="112"></iframe>\n`
      + `<figcaption><span class="doc-example-id">components/callout</span> <a href="https://workbench.example.test/components/callout">Open components/callout in the workbench</a></figcaption>\n`
      + `</figure>\n`);
  });

  it("leaves the workbench's own docs unchanged: inline mode has no variant list", async () => {
    expect(await renderDoc("```pattern components/callout\n```\n", renderComponent, map)).not.toContain("doc-example-variants");
  });
});

describe("renderDoc frame mode — a live example's declared height (x-pd-example-height)", () => {
  let root = "";
  let declared: DiscoveryMap;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pd-example-height-"));
    for (const [rel, text] of Object.entries({
      "components/tip/tip.hbs": `<p>{{text}}</p>\n`,
      "components/tip/tip.schema.json": JSON.stringify({ "x-pd-example-height": 96, properties: { text: { type: "string" } } }),
      "components/tip/tip~short.json": JSON.stringify({ text: "Short" }),
      "components/bad/bad.hbs": `<p>bad</p>\n`,
      "components/bad/bad.schema.json": JSON.stringify({ "x-pd-example-height": 0 }),
      "components/plain/plain.hbs": `<p>plain</p>\n`,
      "components/broken/broken.hbs": `<p>broken</p>\n`,
      "components/broken/broken.schema.json": `{ "x-pd-example-height": 96, `,
    })) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await save(join(root, rel), text);
    }
    declared = (await buildDiscoveryMap(root)).discoveryMap;
  });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("starts the frame at the declared height, as an attribute that holds without script", async () => {
    const problems: string[] = [];
    const html = await renderDoc("```pattern components/tip\n```\n", renderComponent, declared, frame(problems));
    expect(html).toContain(`<iframe src="/preview/components/tip" title="components/tip" loading="lazy" height="96"></iframe>`);
    expect(problems).toEqual([]);
  });

  it("gives a variant its base component's height: one value covers every variant", async () => {
    const html = await renderDoc("```pattern components/tip~short\n```\n", renderComponent, declared, frame());
    expect(html).toContain(`<iframe src="/preview/components/tip~short" title="components/tip~short" loading="lazy" height="96"></iframe>`);
  });

  it("gives a component that declares no height no attribute", async () => {
    const html = await renderDoc("```pattern components/plain\n```\n", renderComponent, declared, frame());
    expect(html).toContain(`<iframe src="/preview/components/plain" title="components/plain" loading="lazy"></iframe>`);
  });

  it("marks an invalid declared height in the page and reports it, so the page fails to build", async () => {
    const problems: string[] = [];
    const html = await renderDoc("```pattern components/bad\n```\n", renderComponent, declared, frame(problems));
    expect(html).toBe(`<p class="doc-error">[pattern: components/bad — invalid x-pd-example-height]</p>`);
    expect(problems).toEqual([
      `pattern components/bad: its schema (bad.schema.json, #/x-pd-example-height): x-pd-example-height must be a whole number of pixels `
      + `above 0 (got 0): the live example's height at the widest column, no taller than its shortest variant`,
    ]);
  });

  it("marks a schema that cannot be read and reports it: the page can't tell what it declares", async () => {
    const problems: string[] = [];
    const html = await renderDoc("```pattern components/broken\n```\n", renderComponent, declared, frame(problems));
    expect(html).toBe(`<p class="doc-error">[pattern: components/broken — its schema cannot be read]</p>`);
    expect(problems).toEqual([expect.stringMatching(/^pattern components\/broken: its schema \(broken\.schema\.json\) cannot be read: \S/)]);
  });
});

describe("renderDoc frame mode — pattern: links", () => {
  it("links to the component in the workbench, at its URL", async () => {
    const html = await renderDoc("See [the callout](pattern:components/callout) and [its warning](pattern:components/callout~warning).", renderComponent, map, frame());
    expect(html).toContain(`<a href="https://workbench.example.test/components/callout" class="pattern-link" data-pattern-id="components/callout">the callout</a>`);
    expect(html).toContain(`<a href="https://workbench.example.test/components/callout#warning" class="pattern-link" data-pattern-id="components/callout" data-variant="warning">its warning</a>`);
  });

  it("marks a link to a component that does not exist, and reports it", async () => {
    const problems: string[] = [];
    const html = await renderDoc("[gone](pattern:components/gone)", renderComponent, map, frame(problems));
    expect(html).toContain(`<a href="#" class="pattern-link--unresolved" aria-disabled="true">gone</a>`);
    expect(problems).toEqual(["pattern:components/gone: there is no such component"]);
  });
});

describe("renderDoc frame mode — the same safety rules", () => {
  it("escapes raw HTML and leaves a javascript: link inert", async () => {
    const html = await renderDoc(`<script>alert(1)</script>\n\n[x](javascript:alert(1))`, renderComponent, map, frame());
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain(`href="javascript:`);
  });

  it("renders the other fences exactly as the workbench does", async () => {
    const md = "```src-template components/callout\n```\n\n```src-data components/callout~warning\n```\n\n```ts\nconst a = 1;\n```\n";
    expect(await renderDoc(md, renderComponent, map, frame())).toBe(await renderDoc(md, renderComponent, map));
  });
});

describe("renderDoc — inline mode is the default", () => {
  it("renders exactly as before when no embed is given", async () => {
    const md = "```pattern components/callout\n```\n\n[c](pattern:components/callout)";
    expect(await renderDoc(md, renderComponent, map)).toBe(await renderDoc(md, renderComponent, map, { embed: "inline" }));
    expect(await renderDoc(md, renderComponent, map)).toContain(`<div class="doc-example"><p class="rendered">components/callout</p></div>`);
  });
});

describe("renderDoc frame mode — the storefront bench's pages", () => {
  it("embeds every example and resolves every link in the bench's pages", async () => {
    const { readFile } = await import("node:fs/promises");
    const pages = fileURLToPath(new URL("../../../storefront-bench/pages/", import.meta.url));
    const problems: string[] = [];
    for (const file of ["index.md", "about.md", "guides/index.md", "guides/setup.md"]) {
      const md = (await readFile(join(pages, file), "utf8")).replace(/^---[\s\S]*?---\n/, "");
      await renderDoc(md, renderComponent, map, frame(problems));
    }
    expect(problems).toEqual([]);
  });
});
