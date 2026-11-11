// pd dev's startup lines name the addresses to open: the website (with a storefront) and the workbench, on the
// port the server is bound to. `Ready in …` stays the last startup line, as scripts wait for it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { startDevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

const here = dirname(fileURLToPath(import.meta.url));
const testBench = join(here, "../../../test-bench");
const storefrontBench = join(here, "../../../storefront-bench");

const plain = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  themes: { dir: "./themes", default: "light", switch: "attribute" },
  assets: { strategy: "central", dir: "./assets" }, scriptsDir: "./src/scripts",
});

let servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => { await Promise.all(servers.map(s => s.close())); servers = []; vi.restoreAllMocks(); });

/** The `[dev-server]` lines a start prints, through `Ready in …`. */
async function startupLines(...args: Parameters<typeof startDevServer>): Promise<{ lines: string[]; port: number }> {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
  const server = await startDevServer(...args);
  servers.push(server);
  vi.restoreAllMocks();
  const startup = lines.filter(l => l.startsWith("[dev-server] "));
  return { lines: startup.slice(0, startup.findIndex(l => l.startsWith("[dev-server] Ready in ")) + 1), port: server.port };
}

describe("pd dev's startup addresses", () => {
  it("with a storefront: the website on its host, the workbench on pd.localhost, at the bound port, before Ready", async () => {
    const config = validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, host: "docs.localhost" } }, "test");
    const { lines, port } = await startupLines(config, storefrontBench, { port: 0, wsPort: 0 });
    expect(port).toBeGreaterThan(0);
    const at = lines.findIndex(l => l.startsWith("[dev-server] Listening at "));
    expect(lines.slice(at, at + 3)).toEqual([
      `[dev-server] Listening at http://127.0.0.1:${port}`,
      `[dev-server] Website:   http://docs.localhost:${port}/`,
      `[dev-server] Workbench: http://pd.localhost:${port}/`,
    ]);
    expect(lines.at(-1)).toMatch(/^\[dev-server\] Ready in \d+ms — \d+ components$/);
  }, 60_000);

  it("without a storefront: one workbench line, on localhost", async () => {
    const { lines, port } = await startupLines(plain, testBench, { port: 0, wsPort: 0 });
    expect(lines.filter(l => /\] (Website|Workbench):/.test(l))).toEqual([`[dev-server] Workbench: http://localhost:${port}/`]);
  }, 60_000);

  it("prints no addresses for a server that is not live (pd build's own)", async () => {
    const { lines } = await startupLines(benchConfig, storefrontBench, { port: 0, wsPort: 0, live: false });
    expect(lines.filter(l => /\] (Website|Workbench):/.test(l))).toEqual([]);
  }, 60_000);
});
