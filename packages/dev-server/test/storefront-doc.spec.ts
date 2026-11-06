// renderDoc in frame mode — the markdown of a storefront page. A `pattern` fence is an iframe on the
// component's own preview document plus a link into the workbench; nothing of the component is rendered
// into the page. `pattern:` links go to the workbench's URL. A missing component is marked in the page
// and reported as a problem. The same parser and the same safety rules as the workbench's docs.
import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { renderDoc, type DocEmbed } from "../src/markdown.js";

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
      + `<iframe src="/preview/components/callout" title="components/callout" loading="lazy"></iframe>\n`
      + `<figcaption><a href="https://workbench.example.test/components/callout">Open components/callout in the workbench</a></figcaption>\n`
      + `</figure>\n`,
    );
    expect(problems).toEqual([]);
    expect(rendered).toBe(0);
  });

  it("addresses a variant by its id, and links to it in the workbench", async () => {
    const html = await renderDoc("```pattern components/callout~warning\n```\n", renderComponent, map, frame());
    expect(html).toContain(`<iframe src="/preview/components/callout~warning" title="components/callout~warning" loading="lazy"></iframe>`);
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
