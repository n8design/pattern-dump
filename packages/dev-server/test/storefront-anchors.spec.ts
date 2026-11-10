// A heading's anchor the layout also has as an id (anchors.ts, assemblePage): the heading gets the next
// free suffix, the layout is rendered again with it, and a note names the change. Same page, same suffix.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage } from "../src/storefront/page.js";
import { collidingHeadings, idsBesides, idsIn } from "../src/storefront/anchors.js";
import { save } from "../../../test-support/save.js";

describe("idsIn", () => {
  it("reads every id attribute, quoted or not, entities decoded, repeats kept", () => {
    expect(idsIn(`<main id="main"><h2 id='a&amp;b'>x</h2><p id=c data-id="no">id="not-a-tag"</p><i id="main"></i></main>`))
      .toEqual(["main", "a&b", "c", "main"]);
  });

  it("never reads text", () => {
    expect(idsIn(`<p>set id=main on it, or id="main"</p>`)).toEqual([]);
  });
});

describe("idsBesides and collidingHeadings", () => {
  const h = (anchor: string) => ({ level: 2, text: anchor, anchor });
  it("counts each heading's own id out once, and finds the headings whose anchor is still taken", () => {
    const headings = [h("main"), h("pages")];
    const ids = idsBesides(`<main id="main"><h2 id="main">Main</h2><h2 id="pages">Pages</h2></main>`, headings);
    expect(ids).toEqual(["main"]);
    expect(collidingHeadings(headings, ids)).toEqual([h("main")]);
    expect(idsBesides(`<h2 id="main">Main</h2><h2 id="pages">Pages</h2>`, headings)).toEqual([]);
  });
});

describe("assemblePage — anchors and the layout's ids", () => {
  let tmp = "";
  beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-anchors-")); });
  afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

  const SCHEMA = JSON.stringify({ properties: { title: { type: "string" }, page: { type: "object", properties: { headings: { type: "array" } } } } });
  const TOC = `<nav>{{#each page.headings}}<a href="#{{anchor}}">{{text}}</a>{{/each}}</nav>`;
  let n = 0;
  const assemble = async (layout: string, markdown: string) => {
    const dir = join(tmp, `p${n++}`);
    const patterns = join(dir, "patterns");
    for (const [rel, body] of Object.entries({ "layouts/page/page.hbs": layout, "layouts/page/page.schema.json": SCHEMA })) {
      await mkdir(dirname(join(patterns, rel)), { recursive: true });
      await save(join(patterns, rel), body);
    }
    await mkdir(join(dir, "pages", "guides"), { recursive: true });
    await save(join(dir, "pages", "index.md"), "---\ntitle: Home\n---\nHome.\n");
    await save(join(dir, "pages", "guides", "index.md"), "---\ntitle: Guides\n---\nGuides.\n");
    await save(join(dir, "pages", "guides", "setup.md"), `---\ntitle: Setup\n---\n${markdown}\n`);
    const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
    return assemblePage("/guides/setup/", await readPages(join(dir, "pages")), {
      discoveryMap, handleMap, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap),
      site: undefined, workbenchUrl: "https://wb.example/", shown: p => p, head: async () => "",
      render: createRenderer({ patternsDir: patterns, discoveryMap, handleMap }),
    });
  };

  it("suffixes a heading whose anchor the layout has (main → main-1), in the body and in page.headings", async () => {
    const page = await assemble(`${TOC}<main id="main">{{{body}}}</main>`, "## Pages\n\n## Main\n");
    expect(page.status).toBe(200);
    expect(page.html).toContain(`<h2 id="main-1">Main</h2>`);
    expect(page.html).toContain(`<a href="#main-1">Main</a>`);
    expect(page.html).toContain(`<a href="#pages">Pages</a>`);
    expect(page.html.match(/ id="main"/g)).toHaveLength(1);
    expect(page.notes).toEqual([`guides/setup.md: heading "Main" is #main-1, because the layout uses id="main"`]);
  });

  it("takes the next free suffix: with main-1 taken as well, main-2", async () => {
    const page = await assemble(`${TOC}<main id="main"><div id="main-1"></div>{{{body}}}</main>`, "## Main\n");
    expect(page.html).toContain(`<h2 id="main-2">Main</h2>`);
    expect(page.html).toContain(`<a href="#main-2">Main</a>`);
    expect(page.notes).toEqual([`guides/setup.md: heading "Main" is #main-2, because the layout uses id="main"`]);
  });

  it("names a heading that moves only because an earlier one took its anchor", async () => {
    const page = await assemble(`${TOC}<main id="main">{{{body}}}</main>`, "## Main\n\n## Main 1\n");
    expect(page.html).toContain(`<h2 id="main-1">Main</h2>`);
    expect(page.html).toContain(`<h2 id="main-1-1">Main 1</h2>`);
    expect(page.notes).toEqual([
      `guides/setup.md: heading "Main" is #main-1, because the layout uses id="main"`,
      `guides/setup.md: heading "Main 1" is #main-1-1, because #main-1 went to an earlier heading whose anchor the layout uses`,
    ]);
  });

  it("gives no note, and renders once, when nothing collides", async () => {
    const page = await assemble(`${TOC}<main id="content">{{{body}}}</main>`, "## Main\n");
    expect(page.html).toContain(`<h2 id="main">Main</h2>`);
    expect(page.notes).toEqual([]);
  });

  it("is a page problem when the layout makes its ids from page.headings, so no suffix can hold", async () => {
    const page = await assemble(`{{#each page.headings}}<span id="{{anchor}}"></span>{{/each}}{{{body}}}`, "## Main\n");
    expect(page.status).toBe(500);
    expect(page.problems).toEqual([
      `guides/setup.md: heading "Main" is #main-1, which the layout has as an id as well, even after the suffix: the layout must not make ids from page.headings`,
    ]);
  });

  it("is the same on every render", async () => {
    const layout = `${TOC}<main id="main">{{{body}}}</main>`;
    const a = await assemble(layout, "## Main\n");
    const b = await assemble(layout, "## Main\n");
    expect(b.html).toBe(a.html);
    expect(b.notes).toEqual(a.notes);
  });
});
