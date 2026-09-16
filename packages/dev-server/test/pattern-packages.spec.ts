// A project that uses a pattern package ALONGSIDE its own patterns, end to end through the server.
//
// Fixture: a project with one own component, plus node_modules/@acme/ui carrying a `patternDump`
// manifest (patterns, styles + base layer, themes, data, helpers, scripts) and a peer package
// @acme/tokens that only contributes its base styles. Everything a manifest can declare must reach
// the running server: tree + source marker, attributed CSS, the base layer, the theme, merged data, a
// package helper, a package script — and the project must win a handle it shares with the package.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ComponentDetailResponse, ComponentTree, TreeNode } from "@pattern-dump/contracts";
import { startDevServer } from "@pattern-dump/dev-server";

let root = "";
let server: { port: number; close: () => Promise<void> };
const get = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);

async function write(files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), body);
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-pattern-packages-"));
  const ui = "node_modules/@acme/ui";
  await write({
    // ---- the project's own
    "src/patterns/molecules/search/search.hbs": '<form class="search">{{> atoms-button }}</form>\n',
    "src/patterns/atoms/badge/badge.hbs": '<span class="own-badge">own</span>\n',
    "src/styles/molecules/search.scss": ".search { display: flex; }\n",
    // Includes the package button at RENDER time through a helper — no {{> …}} for templates to see.
    "src/patterns/molecules/dynamic/dynamic.hbs": '<div class="dynamic">{{include "atoms-button"}}</div>\n',
    "src/_data/site.json": JSON.stringify({ site: { name: "Project" } }),
    "themes/light.theme.scss": '[data-theme="light"] { --surface: #fff; }\n',
    // ---- @acme/ui
    [`${ui}/package.json`]: JSON.stringify({
      name: "@acme/ui", version: "2.0.0",
      peerDependencies: { "@acme/tokens": "2.0.0" },
      patternDump: {
        patterns: "patterns", data: "data", helpers: "helpers", scripts: "ts",
        globalScripts: ["toggle"], assets: ["images"],
        styles: { dir: "sass", entry: "ui.scss" },
        themes: { dir: "themes", default: "dark", switch: "stylesheet" },
        exclude: ["**/legacy/**"],
      },
    }),
    [`${ui}/patterns/atoms/button/button.hbs`]: '<button class="acme-button">{{shout site.name}} {{label}}</button>\n',
    [`${ui}/patterns/atoms/button/button.json`]: JSON.stringify({ label: "Go" }),
    [`${ui}/patterns/atoms/badge/badge.hbs`]: '<span class="acme-badge">lib</span>\n',
    [`${ui}/patterns/atoms/legacy/old.hbs`]: "<p>old</p>\n",
    [`${ui}/data/site.json`]: JSON.stringify({ site: { name: "Library", tagline: "from the package" } }),
    [`${ui}/helpers/shout.cjs`]: "module.exports = (Handlebars) => Handlebars.registerHelper('shout', (s) => String(s).toUpperCase());\n",
    [`${ui}/helpers/include.cjs`]: [
      "module.exports = (Handlebars) => Handlebars.registerHelper('include', function (name) {",
      "  const partial = Handlebars.partials[name];",
      "  const template = typeof partial === 'function' ? partial : Handlebars.compile(partial);",
      "  return new Handlebars.SafeString(template(this));",
      "});",
    ].join("\n"),
    [`${ui}/ts/toggle.ts`]: "export const toggle = (): number => 1;\n",
    [`${ui}/images/logo.svg`]: "<svg xmlns='http://www.w3.org/2000/svg'/>\n",
    [`${ui}/sass/ui.scss`]: '@use "01-atoms/button";\n',
    [`${ui}/sass/01-atoms/_button.scss`]: ".acme-button { color: rebeccapurple; }\n",
    [`${ui}/themes/dark.theme.scss`]: ":root { --surface: #111; }\n",
    [`${ui}/themes/light.theme.scss`]: ":root { --surface: #package-light; }\n",
    // ---- @acme/tokens (peer): base styles only
    "node_modules/@acme/tokens/package.json": JSON.stringify({
      name: "@acme/tokens", version: "2.0.0",
      patternDump: { styles: { dir: "sass", entry: "tokens.scss", documentBase: ["base"] } },
    }),
    "node_modules/@acme/tokens/sass/tokens.scss": '@use "base/reset";\n',
    "node_modules/@acme/tokens/sass/base/_reset.scss": "body { margin: 0; }\n",
  });

  server = await startDevServer({
    sourceDir: "./src",
    patternsDir: "./src/patterns",
    outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    dataDir: "./src/_data",
    themes: { dir: "./themes", default: "light", switch: "attribute" },
    packages: ["@acme/ui"],
  }, root, { port: 0, wsPort: 0 });
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

const flat = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap(n => [n, ...flat(n.children ?? [])]);

describe("pattern packages alongside the project", () => {
  it("the tree holds both, marks package components with their source, and honours the manifest's exclude", async () => {
    const tree = await (await get("/api/tree")).json() as ComponentTree;
    const components = flat(tree.roots).filter(n => n.kind === "component");
    expect(components.map(c => [c.path, c.source ?? "project"]).sort()).toEqual([
      ["atoms/badge", "project"],
      ["atoms/button", "@acme/ui"],
      ["molecules/dynamic", "project"],
      ["molecules/search", "project"],
    ]);
  });

  it("the project's component overrides the package's one with the same handle", async () => {
    const d = await (await get("/api/component/atoms/badge")).json() as ComponentDetailResponse;
    expect(d.document).toContain("own-badge");
    expect(d.document).not.toContain("acme-badge");
  });

  it("a project component composes a package component, with package data, helpers and CSS", async () => {
    const d = await (await get("/api/component/molecules/search")).json() as ComponentDetailResponse;
    expect(d.diagnostics).toEqual([]);
    // Project data overrides package data; the package helper runs.
    expect(d.document).toContain("PROJECT Go");
    expect(d.relationships.uses).toEqual(["atoms/button"]);
    expect(d.document).toContain('href="/_pd/components/atoms/button.css"');
    expect(await (await get("/_pd/components/atoms/button.css")).text()).toContain("rebeccapurple");
  });

  it("links the CSS of a component included at render time by a helper", async () => {
    const d = await (await get("/api/component/molecules/dynamic")).json() as ComponentDetailResponse;
    expect(d.document).toContain("acme-button");
    expect(d.relationships.uses).toEqual([]); // invisible to the template analysis…
    expect(d.document).toContain('href="/_pd/components/atoms/button.css"'); // …but its CSS is linked
    expect(await (await get("/preview/molecules/dynamic")).text()).toContain('href="/_pd/components/atoms/button.css"');
  });

  it("serves the peer's base layer, the package theme, its scripts and assets", async () => {
    expect(await (await get("/_pd/base.css")).text()).toContain("margin: 0");
    // Themes from BOTH sources; the project's own `light` hides the package's; stylesheet switching,
    // because the package's bare :root sets would collide if linked together.
    const themes = await (await get("/api/themes")).json() as Array<{ name: string }>;
    expect(themes.map(t => t.name)).toEqual(["light", "dark"]);
    expect(await (await get("/_pd/themes/light.css")).text()).toContain("#fff");
    expect(await (await get("/_pd/themes/dark.css")).text()).toContain("#111");
    const config = await (await get("/api/config")).json() as { themeSwitch: string; defaultTheme: string };
    expect(config).toMatchObject({ themeSwitch: "stylesheet", defaultTheme: "light" });
    const script = await get("/_pd/scripts/toggle.js");
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("toggle");
    expect((await get("/assets/images/logo.svg")).status).toBe(200);
    const preview = await (await get("/preview/atoms/button")).text();
    expect(preview).toContain("/_pd/scripts/toggle.js");
  });
});
