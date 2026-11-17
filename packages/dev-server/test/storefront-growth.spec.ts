// The work Pattern Dump does to assemble one site page does not grow with the size of the site: building every page
// of a site with four times the pages in one folder (a blog) is about four times the work, not sixteen. Counted as
// the reads of the site's nav entries and page records (each wrapped to count them) while every post is assembled,
// with a layout that doesn't show the nav, so what is counted is Pattern Dump's own per-page work: the nav marked for
// the page, its position (section, breadcrumbs, prev and next), the site check's page list, and the renderer's look
// for data shadowed by a helper.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Render, StorefrontNavItem } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages, type PageModel } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-growth-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const LINK = `{ "type": ["object", "null"], "properties": { "route": { "type": "string" }, "title": { "type": "string" } } }`;
const SKIN: Record<string, string> = {
  "patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}{{#if page.next}}<a href="{{page.next.route}}">{{page.next.title}}</a>{{/if}}</main>\n`,
  "patterns/layouts/page/page.schema.json": `{ "type": "object", "properties": { "title": { "type": "string" }, "body": { "type": "string" },
    "page": { "type": "object", "properties": { "prev": ${LINK}, "next": ${LINK}, "section": ${LINK},
      "breadcrumbs": { "type": "array", "items": ${LINK} } } } } }\n`,
};

/** Every property read of `value` counted in `count`. */
function counted<T extends object>(value: T, count: { reads: number }): T {
  return new Proxy(value, { get(target, key, receiver) { count.reads++; return Reflect.get(target, key, receiver) as unknown; } });
}

/** The reads of nav entries and page records while every post of a site with `n` posts is assembled. */
async function readsFor(n: number): Promise<number> {
  const root = join(tmp, `site-${n}`);
  for (const [rel, text] of Object.entries(SKIN)) await save(join(root, rel), text);
  await save(join(root, "pages", "index.md"), "---\ntitle: Home\n---\n\nHome.\n");
  await save(join(root, "pages", "posts", "index.md"), "---\ntitle: Posts\n---\n\nAll posts.\n");
  for (let i = 0; i < n; i++) {
    await save(join(root, "pages", "posts", `post-${String(i).padStart(4, "0")}.md`), `---\ntitle: Post ${i}\n---\n\nPost ${i}.\n`);
  }
  const patterns = join(root, "patterns");
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const render: Render = createRenderer({ patternsDir: patterns, discoveryMap, handleMap });
  const a: PageAssembly = {
    discoveryMap, handleMap, shown: p => p, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap), render,
    site: undefined, workbenchUrl: "https://wb.test/", head: async () => "", image: async () => ({ ok: true }) as never,
  };
  const read = await readPages(join(root, "pages"));
  const count = { reads: 0 };
  const wrapNav = (item: StorefrontNavItem): StorefrontNavItem =>
    counted({ ...item, ...(item.children ? { children: item.children.map(wrapNav) } : {}) }, count);
  const model: PageModel = {
    ...read,
    nav: read.nav.map(wrapNav),
    pages: read.pages.map(p => counted(p, count)),
    files: new Map([...read.files].map(([route, f]) => [route, counted(f, count)])),
  };
  const posts = [...model.files.keys()].filter(r => r.startsWith("/posts/post-"));
  expect(posts.length).toBe(n);
  count.reads = 0;
  for (const route of posts) {
    const page = await assemblePage(route, model, a);
    expect(page.problems).toEqual([]);
  }
  return count.reads;
}

describe("assembling every page of a site", () => {
  it("grows with the number of pages, not with its square", async () => {
    const small = await readsFor(20);
    const large = await readsFor(80);
    // Linear is 4x; the square of the page count is 16x. Some per-page work is fixed, so linear lands a little under 4.
    expect(large / small).toBeLessThan(6);
  }, 120_000);
});
