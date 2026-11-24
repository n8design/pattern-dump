// Images beside a site's pages (page-images.ts): the pages folder takes them under the page names' rule, with the
// valid name suggested; a relative image in a page's markdown is resolved against the page's folder, must stay
// inside the pages folder, and is then written exactly as one from the assets, at its absolute URL. The renders here
// use a stand-in image index; page-images-site.spec.ts serves and builds the real thing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveryMap, ImageLookup, ImageSource } from "@pattern-dump/contracts";
import { renderDoc, type ProseImages } from "../src/markdown.js";
import { readPages } from "../src/storefront/pages.js";
import { isPageImageUrl, resolvePageImage, suggestImageName } from "../src/storefront/page-images.js";
import { save } from "../../../test-support/save.js";

const raster = (width: number, height: number, name: string): ImageSource => ({
  kind: "variants", width, height,
  variantUrl: (w, settings) => `/_pd/images/${name}.k${settings ?? "-"}.${w}.webp`,
});
const IMAGES: Record<string, ImageSource> = {
  "/shot.png": raster(1200, 800, "shot"),
  "/guide/shot.png": raster(1200, 800, "guide/shot"),
  "/guide/chart.png": raster(1000, 500, "guide/chart"),
  "/guide/chart-dark.png": raster(1000, 500, "guide/chart-dark"),
  "/shared/diagram.svg": { kind: "single", url: "/shared/diagram.svg", width: 64, height: 32 },
  "/assets/images/photo.jpg": raster(1200, 800, "images/photo"),
};
const lookup: ImageLookup = src => IMAGES[src];
const SLOT = { widths: [480, 960], sizes: "100vw", eager: 0 };

/** A page at `pagePath` in the pages folder, rendered with the stand-in index; its problems as "<line>: <message>". */
async function render(body: string, pagePath = "guide/setup.md") {
  const prose: ProseImages = { layoutId: "layouts/page", lookup, lineOffset: 0, problems: [], slot: SLOT, pagePath };
  const html = await renderDoc(body, async () => "", new Map() as DiscoveryMap, { embed: "frame", workbenchUrl: "/wb/", problems: [], prose });
  return { html, problems: prose.problems.map(p => `${p.line}: ${p.message}`) };
}

describe("an image's file name in the pages folder", () => {
  let tmp = "";
  beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-page-images-")); });
  afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

  /** The pages folder's problems with the files `names` beside its home page. */
  async function problemsWith(names: string[], opts: { workbenchPath?: string } = {}): Promise<{ problems: string[]; images: string[] }> {
    const dir = await mkdtemp(join(tmp, "pages-"));
    await save(join(dir, "index.md"), "---\ntitle: Home\n---\n");
    for (const name of names) await save(join(dir, name), "x");
    const model = await readPages(dir, opts);
    return { problems: model.problems, images: model.images };
  }

  const rename = (rel: string, to: string) =>
    `${rel}: an image's file name is part of its URL, so it is lowercase letters, digits and hyphens only, then its extension: rename it to ${to}`;

  it("names from a real migration fail with the valid name suggested, in full", async () => {
    const r = await problemsWith(["Screen-Shot-2023-02-01-at-8.41.01-AM.png", "AskSympraxisThumbnail.jpg", "Guest_Access.PNG"]);
    expect(r.problems).toEqual([
      rename("AskSympraxisThumbnail.jpg", "asksympraxisthumbnail.jpg"),
      rename("Guest_Access.PNG", "guest-access.png"),
      rename("Screen-Shot-2023-02-01-at-8.41.01-AM.png", "screen-shot-2023-02-01-at-8-41-01-am.png"),
    ]);
    expect(r.images).toEqual([]);
  });

  it("a name whose stem comes out empty fails without a suggestion", async () => {
    expect((await problemsWith(["___.png"])).problems).toEqual([
      "___.png: an image's file name is part of its URL, so it is lowercase letters, digits and hyphens only, then its extension",
    ]);
    expect(suggestImageName("___.png")).toBeNull();
  });

  it("valid names, nested and in every format, are the folder's images; other files still fail", async () => {
    const r = await problemsWith(["shot.png", "guide/chart.jpg", "guide/photo.jpeg", "a.gif", "b.webp", "shared/diagram.svg", "notes.txt"]);
    expect(r.problems).toEqual([
      "notes.txt is not a page or an image: only .md files and images (PNG, JPEG, GIF, WebP or SVG) belong in the pages folder (other files go in the project's assets)",
    ]);
    expect(r.images).toEqual(["a.gif", "b.webp", "guide/chart.jpg", "guide/photo.jpeg", "shared/diagram.svg", "shot.png"]);
  });

  it("an image where the server answers itself, or the same-host workbench is published, fails", async () => {
    const r = await problemsWith(["assets/logo.png", "workbench/shot.png"], { workbenchPath: "/workbench/" });
    expect(r.problems).toEqual([
      "assets/logo.png: the image /assets/logo.png is under /assets/, which Pattern Dump serves itself: move it to another folder",
      "workbench/shot.png: the image /workbench/shot.png is under /workbench/, where the workbench is published on this host "
        + "(site.workbenchUrl), so the workbench would overwrite it there",
    ]);
  });

  it("a listing shows a relative frontmatter image at its URL", async () => {
    const dir = await mkdtemp(join(tmp, "pages-"));
    await save(join(dir, "index.md"), "---\ntitle: Home\n---\n");
    await save(join(dir, "guide", "index.md"), "---\ntitle: Guide\nimage: ./cover.png\n---\n");
    await save(join(dir, "guide", "cover.png"), "x");
    await save(join(dir, "other.md"), "---\ntitle: Other\nimage: ./nope.png\n---\n");
    const model = await readPages(dir);
    expect(model.entries.get("/guide/")?.image).toBe("/guide/cover.png");
    expect(model.entries.get("/other/")?.image).toBeNull();
  });
});

describe("resolving a relative image", () => {
  it("against the page's folder, staying inside the pages folder", () => {
    expect(resolvePageImage("./shot.png", "guide/setup.md")).toEqual({ ok: true, rel: "guide/shot.png", url: "/guide/shot.png" });
    expect(resolvePageImage("shot.png", "index.md")).toEqual({ ok: true, rel: "shot.png", url: "/shot.png" });
    expect(resolvePageImage("../shared/diagram.svg", "guide/setup.md")).toEqual({ ok: true, rel: "shared/diagram.svg", url: "/shared/diagram.svg" });
    expect(resolvePageImage("../shot.png", "index.md")).toEqual({ ok: false, outside: true });
    expect(resolvePageImage("../../x.png", "guide/setup.md")).toEqual({ ok: false, outside: true });
  });

  it("a page image's URL is never one the server answers itself", () => {
    expect(isPageImageUrl("/guide/shot.png")).toBe(true);
    for (const url of ["/assets/x.png", "/_pd/images/x.0123456789.960.webp", "/preview/x.png", "/guide/", "/Guide/shot.png", "/guide/shot.PNG"]) {
      expect(isPageImageUrl(url), url).toBe(false);
    }
  });
});

describe("a relative image in a page's markdown", () => {
  it("beside the page: its variants, at its absolute URL, the same as an image from the assets", async () => {
    const own = await render(`![A launch](./shot.png)\n`);
    const asset = await render(`![A launch](/assets/images/photo.jpg)\n`);
    expect(own.problems).toEqual([]);
    expect(own.html).toBe(asset.html.replaceAll("images/photo", "guide/shot"));
    expect(own.html).toContain(`src="/_pd/images/guide/shot.ksite.960.webp"`);
  });

  it("a bare name, in the top folder", async () => {
    const r = await render(`![A launch](shot.png)\n`, "index.md");
    expect(r.problems).toEqual([]);
    expect(r.html).toContain(`src="/_pd/images/shot.ksite.960.webp"`);
  });

  it("../ inside the pages folder: an SVG at its own size", async () => {
    const r = await render(`![The flow](../shared/diagram.svg)\n`);
    expect(r.problems).toEqual([]);
    expect(r.html).toBe(`<p><img src="/shared/diagram.svg" width="64" height="32" alt="The flow" loading="lazy" decoding="async"></p>\n`);
  });

  it("a sibling -dark file: a <picture>; a caption: a <figure>", async () => {
    const r = await render(`![Sales](chart.png "Sales, 2026")\n`);
    expect(r.problems).toEqual([]);
    expect(r.html).toMatch(/^<figure class="doc-figure">\n<picture><source media="\(prefers-color-scheme: dark\)" srcset="\/_pd\/images\/guide\/chart-dark\.ksite\.480\.webp 480w, /);
    expect(r.html).toContain(`<figcaption>Sales, 2026</figcaption>`);
  });

  it("../ leaving the pages folder fails at its line", async () => {
    expect((await render(`Text.\n\n![Out](../../elsewhere.png)\n`)).problems).toEqual([
      "3: the image ../../elsewhere.png is outside the pages folder: a relative image stays inside site.pagesDir (an image from elsewhere goes in the assets, as /assets/…)",
    ]);
  });

  it("a missing file fails, naming the resolved path", async () => {
    expect((await render(`![Gone](./gone.png)\n`)).problems).toEqual([
      "1: the image ./gone.png is not beside the page: there is no guide/gone.png in the pages folder",
    ]);
  });

  it("needs alt text, as every image does", async () => {
    expect((await render(`![](./shot.png)\n`)).problems).toEqual([
      `1: the image ./shot.png has no alt text: write what it shows between the brackets; a decorative image goes in through a component, with alt=""`,
    ]);
  });

  it("a link keeps its own rule: a bare relative link is still not a link", async () => {
    expect((await render(`[Shot](shot.png)\n`)).html).toBe(`<p>[Shot](shot.png)</p>\n`);
  });
});
