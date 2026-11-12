// A component whose schema misuses the placement extensions: the workbench shows it on the component (its
// detail's diagnostics, SCHEMA_INVALID) before any page uses it, and a page that places it is refused with
// the same message.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { ComponentDetail } from "@pattern-dump/contracts";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPlacedBlocks } from "../src/placed-tags.js";
import { readSchema } from "../src/storefront/declared-values.js";
import { placeBlock } from "../src/storefront/placed.js";
import { save } from "../../../test-support/save.js";

const FILES: Record<string, string> = {
  "src/patterns/atoms/note/note.hbs": `<p class="note">{{text}}</p>\n`,
  // A typo in an extension: "x-pd-contnet".
  "src/patterns/atoms/note/note.schema.json": JSON.stringify({ "x-pd-contnet": "text", properties: { text: { type: "string" } } }),
};
let root = "";
let server: DevServer;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-placed-schema-"));
  for (const [rel, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  await mkdir(join(root, "src/styles"), { recursive: true });
  server = await startDevServer(validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" },
  }), "site"), root, { port: 0, live: false });
}, 60_000);
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("a schema that misuses a placement extension", () => {
  it("shows on its component in the workbench, before any page places it", async () => {
    const detail = await (await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/note`)).json() as ComponentDetail;
    expect(detail.diagnostics.filter(d => d.kind === "SCHEMA_INVALID")).toEqual([{
      kind: "SCHEMA_INVALID", severity: "error", source: "schema", path: "#/x-pd-contnet",
      message: `"x-pd-contnet" is not a schema extension Pattern Dump knows (x-pd-component, x-pd-content, x-pd-example-height)`,
      location: { file: "src/patterns/atoms/note/note.schema.json" },
    }]);
  });

  it("is refused where a page places it, with the same message", async () => {
    const patterns = join(root, "src/patterns");
    const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
    const r = await placeBlock(readPlacedBlocks(`<pd-atoms-note text="hi"></pd-atoms-note>\n`)[0], {
      discoveryMap, handleMap,
      composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap),
      render: createRenderer({ patternsDir: patterns, discoveryMap, handleMap }),
      schemaOf: async id => (await readSchema(discoveryMap.get(id)?.schemaPath)).schema,
      shown: path => relative(root, path),
    });
    expect(r.html).toBeUndefined();
    expect(r.problems.map(p => p.message)).toEqual([
      `atoms/note cannot be placed: its schema (src/patterns/atoms/note/note.schema.json, #/x-pd-contnet): "x-pd-contnet" is not a schema extension Pattern Dump knows (x-pd-component, x-pd-content, x-pd-example-height)`,
    ]);
  });
});
