// {{pd-image}} when sharp can't be loaded (decided for step 4, PR 3): pd dev shows each image as it is, at its size,
// and warns once; pd build fails the page with the named sharp error, since every image it writes is encoded; pd
// audit renders as pd dev does and returns the warning once, for its summary. The build package's loader is replaced
// with one that fails as a missing binary does, so the server, the build and the audit run from source here.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@pattern-dump/build", async importOriginal => {
  const actual = await importOriginal<typeof import("@pattern-dump/build")>();
  return { ...actual, loadSharp: () => Promise.reject(new actual.SharpUnavailableError(new Error("Could not load the \"sharp\" module (test)"))) };
});

const { defineConfig } = await import("@pattern-dump/config");
const { PD_HOSTS } = await import("@pattern-dump/contracts");
const { startDevServer } = await import("../src/index.js");
const { buildStaticSite } = await import("../src/static-build.js");
const { runDiagnosticsAudit } = await import("../src/audit.js");
const { save } = await import("../../../test-support/save.js");

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
const NAMED = `Pattern Dump could not load sharp, which encodes its responsive images (Could not load the "sharp" module (test)).`;
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://workbench.example.test/" },
});
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-image-no-sharp-"));
  await mkdir(join(root, "src", "assets", "images"), { recursive: true });
  await copyFile(join(fixtures, "portrait-exif6.jpg"), join(root, "src", "assets", "images", "tower.jpg"));
  for (const [rel, body] of Object.entries({
    "src/patterns/atoms/pic/pic.hbs": `{{pd-image image alt=alt}}\n`,
    "src/patterns/atoms/pic/pic.schema.json": JSON.stringify({ required: ["image", "alt"], properties: {
      image: { type: "string", "x-pd-image": { widths: [160, 320], sizes: "100vw" } }, alt: { type: "string" } } }),
    "src/patterns/atoms/pic/pic.json": JSON.stringify({ image: "/assets/images/tower.jpg", alt: "A tower" }),
    "src/patterns/atoms/pic2/pic2.hbs": `{{pd-image image alt=alt}}\n`,
    "src/patterns/atoms/pic2/pic2.schema.json": JSON.stringify({ required: ["image", "alt"], properties: {
      image: { type: "string", "x-pd-image": { widths: [160], sizes: "100vw" } }, alt: { type: "string" } } }),
    "src/patterns/atoms/pic2/pic2.json": JSON.stringify({ image: "/assets/images/tower.jpg", alt: "Again" }),
    "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    "pages/index.md": `---\ntitle: Home\n---\n\n<pd-atoms-pic image="/assets/images/tower.jpg" alt="A tower"></pd-atoms-pic>\n`,
  })) await save(join(root, rel), body);
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("images when sharp can't be loaded", () => {
  it("pd dev shows the original at its size as displayed, and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = await startDevServer(config, root, { port: 0, wsPort: 0, live: true });
    try {
      const site = config.storefront!.host ?? PD_HOSTS.storefront;
      const get = (path: string, host: string) => new Promise<string>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${host}:${server.port}` } }, r => {
          let body = ""; r.setEncoding("utf8"); r.on("data", c => { body += c; }); r.on("end", () => resolve(body));
        });
        req.on("error", reject); req.end();
      });
      const original = (src: string) => `<img src="${src}" width="320" height="480" alt="A tower" loading="lazy" decoding="async">`;
      // On the storefront's host the original carries its content stamp, like every file a page links.
      expect(await get("/", site)).toMatch(new RegExp(original("/assets/images/tower\\.jpg\\?v=[0-9a-f]{10}").replace(/[.]/g, ".")));
      expect(await get("/preview/atoms/pic", PD_HOSTS.workbench)).toContain(original("/assets/images/tower.jpg"));
      const warnings = warn.mock.calls.flat().filter(m => String(m).includes("could not load sharp"));
      expect(warnings).toEqual([`[dev-server] ${NAMED} npm installs sharp's binary for ${process.platform}-${process.arch} as an optional dependency: `
        + `reinstall without --omit=optional (or --no-optional). Until it loads, images are shown as they are, not as variants.`]);
    } finally {
      await server.close();
      warn.mockRestore();
    }
  });

  it("pd build fails the page with the named sharp error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(buildStaticSite(config, root, { outDir: join(root, "workbench-out"), pdVersion: "0.0.0-test" }))
        .rejects.toThrow(/pd build: the storefront has problems, so nothing was written:[\s\S]*Pattern Dump could not load sharp/);
    } finally {
      error.mockRestore();
    }
  });

  it("pd audit renders as pd dev does, and returns the warning once for its summary", async () => {
    const { imageWarning } = await runDiagnosticsAudit(config, root);
    expect(imageWarning).toMatch(/^Pattern Dump could not load sharp, .* Until it loads, images are shown as they are, not as variants\.$/);
  });
});
