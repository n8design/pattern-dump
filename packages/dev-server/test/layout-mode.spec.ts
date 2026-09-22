// Preview layout resolution: the category default and the two overrides above it.
//
// Nothing pinned this before, and every patterns fixture in the repo is unnumbered — which is how a
// PatternLab tree (`04-templates`, `05-pages`) came to miss the `full` default entirely: the category
// was compared with its ordering prefix still on it. Fixtures here are throwaway, as in tree-order.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap, stripOrderPrefixes } from "@pattern-dump/discovery";
import { resolveLayoutMode } from "../src/layout-mode.js";
import { buildFolderOverview } from "../src/overview.js";
import { buildComponentTree } from "../src/component-tree.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

/** A patterns tree: each path gets a file with that content (`.hbs` markup unless given). */
async function patterns(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pd-layout-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), text);
  }
  return root;
}

const NUMBERED = {
  "01-atoms/badge.hbs": "<span>b</span>",
  "04-templates/sample-article.hbs": "<article>a</article>",
  "05-pages/home.hbs": "<div>h</div>",
};

describe("stripOrderPrefixes", () => {
  it("drops a numeric ordering prefix from every segment", () => {
    expect(stripOrderPrefixes("04-templates")).toBe("templates");
    expect(stripOrderPrefixes("00-atoms/01-global/00-colors")).toBe("atoms/global/colors");
    expect(stripOrderPrefixes("01_molecules/card")).toBe("molecules/card");
  });

  it("leaves names that merely contain digits alone", () => {
    expect(stripOrderPrefixes("atoms/h1")).toBe("atoms/h1");
    expect(stripOrderPrefixes("atoms/2col-grid")).toBe("atoms/2col-grid");
    expect(stripOrderPrefixes("404/page")).toBe("404/page");
  });
});

describe("resolveLayoutMode — category default", () => {
  it("pages and templates are full, with or without an ordering prefix", async () => {
    const dir = await patterns(NUMBERED);
    const { discoveryMap } = await buildDiscoveryMap(dir);
    expect(await resolveLayoutMode("04-templates/sample-article", dir, discoveryMap)).toBe("full");
    expect(await resolveLayoutMode("05-pages/home", dir, discoveryMap)).toBe("full");
    expect(await resolveLayoutMode("01-atoms/badge", dir, discoveryMap)).toBe("centered");
  });

  it("an unnumbered tree is unchanged", async () => {
    const dir = await patterns({
      "atoms/badge.hbs": "<span>b</span>",
      "templates/sample.hbs": "<article>a</article>",
      "pages/home.hbs": "<div>h</div>",
    });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    expect(await resolveLayoutMode("templates/sample", dir, discoveryMap)).toBe("full");
    expect(await resolveLayoutMode("pages/home", dir, discoveryMap)).toBe("full");
    expect(await resolveLayoutMode("atoms/badge", dir, discoveryMap)).toBe("centered");
  });
});

describe("resolveLayoutMode — overrides above the default", () => {
  it("a numbered folder's index.md still overrides its category default", async () => {
    const dir = await patterns({
      ...NUMBERED,
      "04-templates/index.md": "---\npreview: centered\n---\n",
      "01-atoms/index.md": "---\npreview: full\n---\n",
    });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    expect(await resolveLayoutMode("04-templates/sample-article", dir, discoveryMap)).toBe("centered");
    expect(await resolveLayoutMode("01-atoms/badge", dir, discoveryMap)).toBe("full");
  });

  it("a component's own .md wins over both", async () => {
    const dir = await patterns({
      ...NUMBERED,
      "04-templates/index.md": "---\npreview: centered\n---\n",
      "04-templates/sample-article.md": "---\npreview: full\n---\n",
    });
    const { discoveryMap } = await buildDiscoveryMap(dir);
    expect(await resolveLayoutMode("04-templates/sample-article", dir, discoveryMap)).toBe("full");
  });
});

describe("a numbered folder elsewhere", () => {
  it("the folder page carries the same layout as its components", async () => {
    const dir = await patterns(NUMBERED);
    const { discoveryMap } = await buildDiscoveryMap(dir);
    const render = async () => ({ html: "<p>x</p>" });
    expect((await buildFolderOverview("05-pages", dir, render, discoveryMap)).layout).toBe("full");
    expect((await buildFolderOverview("01-atoms", dir, render, discoveryMap)).layout).toBe("centered");
  });

  it("the tree reports the resolved layout per component", async () => {
    const dir = await patterns(NUMBERED);
    const dr = await buildDiscoveryMap(dir);
    const tree = await buildComponentTree(dir, true, dr.discoveryMap);
    const templates = tree.roots.find(n => n.path === "04-templates");
    expect(templates?.children?.[0]?.layout).toBe("full");
    // The label keeps the prefix: "2-col" is a name and "04-templates" a prefix, and the string does
    // not say which (tree-order.spec pins that). A numbered folder sets `title:` for a clean label.
    expect(templates?.title).toBe("04 templates");
  });
});
