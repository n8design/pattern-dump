// When sharp can't be loaded, the image route answers 500 with the named error, never a broken image or a silent
// fallback; pd build reports that answer as the page's problem. Simulated by replacing the build package's loader
// with one that fails as a missing binary does.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@pattern-dump/build", async importOriginal => {
  const actual = await importOriginal<typeof import("@pattern-dump/build")>();
  return {
    ...actual,
    loadSharp: () => Promise.reject(new actual.SharpUnavailableError(new Error(`Could not load the "sharp" module using the ${process.platform}-${process.arch} runtime`))),
  };
});

const { imageVariantKey } = await import("@pattern-dump/build");
const { defineConfig } = await import("@pattern-dump/config");
const { imageUrl } = await import("@pattern-dump/contracts");
const { startDevServer } = await import("../src/index.js");
const { save } = await import("../../../test-support/save.js");

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
let tmp = "";
let server: Awaited<ReturnType<typeof startDevServer>>;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-no-sharp-"));
  await mkdir(join(tmp, "src", "assets", "images"), { recursive: true });
  await save(join(tmp, "src", "patterns", "atoms", "a", "a.hbs"), "<p>a</p>\n");
  await copyFile(join(fixtures, "photo.jpg"), join(tmp, "src", "assets", "images", "harbour.jpg"));
  server = await startDevServer(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  }), tmp, { port: 0, live: false });
});
afterAll(async () => {
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("the image route without sharp", () => {
  it("answers 500 with the named error", async () => {
    const key = imageVariantKey(await readFile(join(fixtures, "photo.jpg")), 240, { quality: 75, effort: 4 });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: server.port, path: imageUrl("images/harbour", key, 240) }, r => {
          let body = ""; r.setEncoding("utf8"); r.on("data", c => { body += c; }); r.on("end", () => resolve({ status: r.statusCode ?? 0, body }));
        });
        req.on("error", reject); req.end();
      });
      expect(res.status).toBe(500);
      expect(res.body).toMatch(/^Pattern Dump could not load sharp, which encodes its responsive images \(Could not load the "sharp" module/);
      expect(res.body).toContain("reinstall without --omit=optional");
      expect(errors.mock.calls.flat().join("\n")).toContain("Pattern Dump could not load sharp");
    } finally {
      errors.mockRestore();
    }
  });
});
