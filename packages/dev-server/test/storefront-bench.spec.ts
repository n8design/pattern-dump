// The storefront bench's skin — its layouts and partials — and the component its pages embed are
// ordinary patterns: the workbench lists each one, documents it, and renders a preview with real content
// from its sample data. Read from the bench as committed, with its own config.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { validateConfig } from "@pattern-dump/config";
import { componentUrl, previewUrl, type ComponentDetailResponse, type ComponentTree, type TreeNode } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));

let server: DevServer;
let origin = "";

beforeAll(async () => {
  server = await startDevServer(validateConfig(benchConfig, "storefront-bench"), bench, { port: 0, live: false });
  origin = `http://127.0.0.1:${server.port}`;
}, 120_000);

afterAll(async () => { await server?.close(); });

/** The preview's visible text (scripts removed, whitespace collapsed) and its element count. */
async function preview(id: string): Promise<{ status: number; text: string; elements: number }> {
  const res = await fetch(origin + previewUrl(id));
  const body = parse(await res.text()).querySelector("body");
  body?.querySelectorAll("script").forEach(s => s.remove());
  return {
    status: res.status,
    text: (body?.textContent ?? "").replace(/\s+/g, " ").trim(),
    elements: body?.querySelectorAll("*").length ?? 0,
  };
}

// id → its docs title and description, its preview layout, and text its sample data must put on screen.
const SKIN: Array<[id: string, title: string, description: string, layout: string, shows: string[]]> = [
  ["layouts/page", "Page", "The default layout — a heading, an optional description, and the page's body.", "full",
    ["Storefront bench", "A small website rendered from markdown", "This is the body of a page", "Built with Pattern Dump"]],
  ["layouts/article", "Article", "A longer text — a heading, a lede, and the page's body.", "full",
    ["Setup", "Three folders make a site", "Each markdown file in pages/ is a page", "Guides"]],
  ["layouts/doc", "Doc", "A page with a table of contents, from what the storefront derives for it.", "full",
    ["Setup", "Three folders make a site", "Pages", "Layouts", "Each markdown file in pages/ is a page"]],
  ["layouts/home", "Home", "The front page — the site's name as its heading, an optional description, and the page's body.", "full",
    ["Storefront bench", "A small website rendered from markdown", "The home page: the site’s name", "Guides", "Setup", "About"]],
  ["layouts/listing", "Listing", "A folder's index.md that lists the folder's pages, each as a card.", "full",
    ["Articles", "Everything written for the bench, newest first.", "A harbour of cable cars", "Plain on purpose"]],
  // A card is included by a layout, so it has no sample data of its own (its article variant has).
  ["components/card", "Card", "One entry of a listing (layouts/listing, page.children): a title linking to the page, its date, its teaser and its image.", "centered", []],
  ["partials/base", "Base", "The frame every layout fills — header, navigation, the page's content, footer.", "centered",
    ["Storefront bench", "Guides", "Built with Pattern Dump from the storefront bench."]],
  ["partials/header", "Header", "The site title and tagline, linking home.", "centered",
    ["Storefront bench", "A website written in markdown"]],
  ["partials/nav", "Nav", "The site navigation, one level deep, with the current page marked by aria-current.", "centered",
    ["Home", "Guides", "Setup", "About"]],
  // Its sample-free markup is all head elements, so the preview shows no text.
  ["partials/head", "Head", "The site's icon and theme colour, in every page's head.", "centered", []],
  ["partials/footer", "Footer", "The footer navigation, the line at the bottom of every page, and the year.", "centered",
    ["Built with Pattern Dump from the storefront bench.", "© 2026"]],
  ["components/callout", "Callout", "A short note set apart from the text around it.", "centered",
    ["Good to know", "A callout sets a short note apart"]],
];
/** The components the guides page places with values (pd- tags): a slider and its slides. */
const PLACED = ["components/slide", "components/slider"];

describe("storefront bench in the workbench", () => {
  it("lists the skin's layouts and partials, the embedded component and the placed ones, and nothing else", async () => {
    const tree = await (await fetch(origin + "/api/tree")).json() as ComponentTree;
    const ids: string[] = [];
    const walk = (nodes: TreeNode[]): void => nodes.forEach(n => { if (n.kind === "component") ids.push(n.path); walk(n.children ?? []); });
    walk(tree.roots);
    expect(ids.sort()).toEqual([...SKIN.map(([id]) => id), ...PLACED].sort());
  });

  for (const [id, title, description, layout, shows] of SKIN) {
    it(`documents ${id}, with no diagnostics`, async () => {
      const detail = await (await fetch(origin + componentUrl(id))).json() as ComponentDetailResponse;
      expect(detail.title).toBe(title);
      expect(detail.description).toBe(description);
      expect((detail.doc ?? "").trim()).not.toBe("");
      expect(detail.layout).toBe(layout);
      expect(detail.diagnostics ?? []).toEqual([]);
    });

    it(`renders ${id}'s preview with its sample content`, async () => {
      const p = await preview(id);
      expect(p.status).toBe(200);
      expect(p.elements).toBeGreaterThan(0);
      for (const text of shows) expect(p.text, `${id} shows "${text}"`).toContain(text);
    });
  }

  it("renders the card's article variant from its own data", async () => {
    const p = await preview("components/card~article");
    expect(p.status).toBe(200);
    expect(p.text).toContain("A harbour of cable cars");
    expect(p.text).toContain("2026-11-01");
  });

  it("renders the callout's warning variant from its own data", async () => {
    const p = await preview("components/callout~warning");
    expect(p.status).toBe(200);
    expect(p.text).toContain("Careful");
    expect(p.text).toContain("A warning callout marks something that can go wrong.");
  });
});
