// The bench in pd dev: every component comes from one of its two packages, attributed to it, documented
// with no diagnostics, and rendered with its package's compiled helpers, styles, script and asset; the
// storefront's pages render through the skin's layout.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import type { ComponentDetailResponse, ComponentTree, TreeNode } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../pattern-dump.config.js";

const bench = fileURLToPath(new URL("../", import.meta.url));
let server: DevServer;
let origin = "";

beforeAll(async () => {
  server = await startDevServer(validateConfig(benchConfig, "package-bench"), bench, { port: 0, live: false });
  origin = `http://127.0.0.1:${server.port}`;
}, 60_000);
afterAll(async () => { await server?.close(); });

const storefront = (path: string): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  request({ host: "127.0.0.1", port: server.port, path, headers: { host: `live.localhost:${server.port}` } }, res => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", c => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
  }).on("error", reject).end();
});

describe("the package bench in the workbench", () => {
  it("lists the packages' components, each attributed to its package, and nothing of its own", async () => {
    const tree = await (await fetch(`${origin}/api/tree`)).json() as ComponentTree;
    const found: string[][] = [];
    const walk = (nodes: TreeNode[]): void => nodes.forEach(n => { if (n.kind === "component") found.push([n.path, String(n.source)]); walk(n.children ?? []); });
    walk(tree.roots);
    expect(found.sort()).toEqual([
      ["atoms/chip", "pd-fixture-ds"], ["layouts/page", "pd-fixture-skin"],
      ["molecules/card", "pd-fixture-ds"], ["partials/base", "pd-fixture-skin"],
    ]);
  });

  for (const id of ["atoms/chip", "molecules/card", "layouts/page", "partials/base"]) {
    it(`documents ${id}, with no diagnostics`, async () => {
      const detail = await (await fetch(`${origin}/api/component/${id}`)).json() as ComponentDetailResponse;
      expect((detail.doc ?? "").trim()).not.toBe("");
      expect(detail.diagnostics ?? []).toEqual([]);
    });
  }

  it("renders a component with its package's helper, styles, base layer, theme and script", async () => {
    const html = await (await fetch(`${origin}/preview/atoms/chip`)).text();
    expect(html).toContain(`<span class="ds-chip">DS:Chip</span>`);
    for (const href of ["/_pd/base.css", "/_pd/themes/light.css", "/_pd/components/atoms/chip.css"]) expect(html).toContain(`href="${href}`);
    expect(html).toMatch(/src="\/_pd\/scripts\/chip\.js/);
    const css = await (await fetch(`${origin}/_pd/components/atoms/chip.css`)).text();
    expect(css).toContain(`url("/assets/pd-fixture-ds/dot.svg")`);
    const asset = await fetch(`${origin}/assets/pd-fixture-ds/dot.svg`);
    expect([asset.status, asset.headers.get("content-type")]).toEqual([200, "image/svg+xml"]);
  });
});

describe("the package bench's storefront", () => {
  it("renders each page through the skin's layout and helper, with the design system's components", async () => {
    const home = await storefront("/");
    expect(home.status).toBe(200);
    expect(home.body).toContain(`<h1 class="sk-title">PACKAGE BENCH</h1>`);
    expect(home.body).toContain(`<iframe src="/preview/molecules/card"`);
    const about = await storefront("/about/");
    expect(about.status).toBe(200);
    expect(about.body).toContain(`<h1 class="sk-title">ABOUT</h1>`);
    expect(about.body).toContain(`<iframe src="/preview/atoms/chip~strong"`);
  });
});
