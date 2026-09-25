// /preview/<id>~<variant> renders exactly what /preview/<id>?variant=<variant> does: the variant on
// top of its base component (base data, template and schema), not the variant's data on its own.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";

const here = dirname(fileURLToPath(import.meta.url));
const testBench = join(here, "../../../test-bench");
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  themes: { dir: "./themes", default: "light", switch: "attribute" },
  assets: { strategy: "central", dir: "./assets" }, scriptsDir: "./src/scripts",
});

let server: { port: number; close: () => Promise<void> };
beforeAll(async () => { server = await startDevServer(config, testBench, { port: 0, wsPort: 0 }); }, 30_000);
afterAll(async () => { await server?.close(); });

const body = async (path: string) => {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
  expect(res.status).toBe(200);
  // The body's content: <body data-component-id> names the requested route id, which differs by design.
  return /<body[^>]*>([\s\S]*)<\/body>/.exec(await res.text())?.[1];
};

describe("/preview by variant id", () => {
  it("equals the ?variant= render", async () => {
    const byId = await body("/preview/atoms/chip~danger");
    expect(byId).toContain("Danger Chip");
    expect(byId).toBe(await body("/preview/atoms/chip?variant=danger"));
  });
});
