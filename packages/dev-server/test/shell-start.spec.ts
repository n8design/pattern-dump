// The workbench's start item (config shell.start): /api/config carries it for the shell, which opens it at the root;
// a start item that names no component stops pd dev (and pd build, which runs it) at start, with the nearest id.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { PD_ROUTES, type ShellClientConfig } from "@pattern-dump/contracts";
import { startDevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let root = "";
const config = (start: string): PatternDumpConfig => defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, shell: { start },
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-shell-start-"));
  await save(join(root, "src/patterns/layouts/home/home.hbs"), `<main>Home</main>\n`);
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("shell.start", () => {
  it("is in /api/config, for the shell to open at the root", async () => {
    const server = await startDevServer(config("layouts/home"), root, { port: 0, wsPort: 0 });
    try {
      const c = await (await fetch(`http://127.0.0.1:${server.port}${PD_ROUTES.config}`)).json() as ShellClientConfig;
      expect(c.shell?.start).toBe("layouts/home");
    } finally { await server.close(); }
  });

  it("naming no component stops pd dev at start, with the nearest id", async () => {
    await expect(startDevServer(config("layouts/hom"), root, { port: 0, wsPort: 0 }))
      .rejects.toThrow(`"shell.start": there is no component "layouts/hom": did you mean "layouts/home"?`);
  });
});
