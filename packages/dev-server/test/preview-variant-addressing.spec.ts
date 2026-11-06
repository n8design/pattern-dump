// A storefront page embeds a variant's preview by its id, /preview/<id>~<variant>: a static host cannot
// serve a query string, and the id form maps to its own file through staticPathFor unchanged. That is
// only sound if the id form is the same document as /preview/<id>?variant=<variant> — markup, stylesheet
// links, scripts, all of it — for every variant there is. The one difference allowed is
// data-component-id on <body>, which names the requested route.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { defineConfig, validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { componentUrl, previewUrl, type ComponentDetailResponse, type ComponentTree, type TreeNode } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

const testBenchConfig = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  themes: { dir: "./themes", default: "light", switch: "attribute" },
  assets: { strategy: "central", dir: "./assets" },
  scriptsDir: "./src/scripts", helpers: "./src/helpers", dataDir: "./src/_data",
  packages: ["pd-fixture-ui"],
});

// name, root, config; a synthesized base it must cover (M6: a base made from its variants alone, with no
// template of its own); and the bases whose unknown variants are checked.
const PROJECTS: Array<[name: string, root: string, config: PatternDumpConfig, synthesized: string | null, unknownOn: string[]]> = [
  ["test-bench", fileURLToPath(new URL("../../../test-bench/", import.meta.url)), testBenchConfig, "atoms/badge", ["atoms/button", "atoms/badge"]],
  ["storefront-bench", fileURLToPath(new URL("../../../storefront-bench/", import.meta.url)), validateConfig(benchConfig, "storefront-bench"), null, ["components/callout"]],
];

const servers: DevServer[] = [];
afterAll(async () => { await Promise.all(servers.map(s => s.close())); });

/** The document with the one attribute that names the requested route taken out. */
const comparable = (doc: string): string => doc.replace(/(<body[^>]*?) data-component-id="[^"]*"/, "$1");

for (const [name, root, config, synthesized, unknownOn] of PROJECTS) {
  describe(`/preview/<id>~<variant> is /preview/<id>?variant=<variant>, on ${name}`, () => {
    let origin = "";
    const variants: Array<[id: string, variant: string]> = [];

    beforeAll(async () => {
      const server = await startDevServer(config, root, { port: 0, live: false });
      servers.push(server);
      origin = `http://127.0.0.1:${server.port}`;
      const tree = await (await fetch(origin + "/api/tree")).json() as ComponentTree;
      const ids: string[] = [];
      const walk = (nodes: TreeNode[]): void => nodes.forEach(n => { if (n.kind === "component") ids.push(n.path); walk(n.children ?? []); });
      walk(tree.roots);
      for (const id of ids.sort()) {
        const detail = await (await fetch(origin + componentUrl(id))).json() as ComponentDetailResponse;
        for (const v of detail.variants ?? []) variants.push([id, v.name]);
      }
    }, 120_000);

    it("has variants to compare", () => {
      expect(variants.length).toBeGreaterThan(0);
    });

    if (synthesized) {
      it(`covers a synthesized base: ${synthesized}, whose variants have no base template`, async () => {
        const { discoveryMap } = await buildDiscoveryMap(`${root}${config.patternsDir.replace(/^\.\//, "")}`);
        expect(discoveryMap.get(synthesized)?.hbsPath).toBe("");
        expect(variants.filter(([id]) => id === synthesized).length).toBeGreaterThan(0);
      });
    }

    it("answers an unknown variant of a known base the same way both ways", async () => {
      for (const id of unknownOn) {
        const [byId, byQuery] = await Promise.all([
          fetch(`${origin}/preview/${id}~no-such-variant`), fetch(origin + previewUrl(id, "no-such-variant")),
        ]);
        expect(byId.status, id).toBe(byQuery.status);
        expect(byId.status, id).not.toBe(200);
        expect(await byId.text(), id).toBe(await byQuery.text());
      }
    });

    it("serves the same document both ways, for every variant", async () => {
      const differing: string[] = [];
      for (const [id, variant] of variants) {
        const [byId, byQuery] = await Promise.all([
          fetch(`${origin}/preview/${id}~${variant}`), fetch(origin + previewUrl(id, variant)),
        ]);
        expect(byId.status, `${id}~${variant}`).toBe(byQuery.status);
        if (comparable(await byId.text()) !== comparable(await byQuery.text())) differing.push(`${id}~${variant}`);
      }
      expect(differing).toEqual([]);
    });
  });
}
