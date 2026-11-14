// `pd build --browser` in a real Chromium (browser-checks.ts): a page whose text fails contrast stops the build; an
// image whose slot's sizes doesn't match its box is a warning in the report; and the bench itself passes, its slider's
// slot saying the width its three-up row gives a slide. Playwright here is the repository's, as a project's own would be.
import { test, expect, chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../pattern-dump.config.js";
import { save } from "../../test-support/save.js";

test.setTimeout(120_000);
const loadPlaywright = async () => ({ chromium });
const bench = fileURLToPath(new URL("../", import.meta.url));

/** A PNG of one flat colour, made here. */
function flatPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    typed.copy(out, 4);
    out.writeUInt32BE(crc32(typed), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

let tmp = "";
test.beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-build-browser-")); });
test.afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const config = validateConfig(defineConfig({
  outDir: "./.out/wb", assets: { dir: "./assets" },
  storefront: { pagesDir: "./pages", outDir: "./.out/site", workbenchUrl: "https://wb.test/" },
}), "test");
async function project(name: string, files: Record<string, string | Buffer>): Promise<string> {
  const root = join(tmp, name);
  for (const [rel, text] of Object.entries({
    "src/patterns/layouts/page/page.hbs": `<header><p>Site</p></header><main class="page"><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
    ...files,
  })) await save(join(root, rel), text);
  return root;
}

test("text that fails contrast stops the build, and nothing is written", async () => {
  const root = await project("contrast", {
    "src/styles/layouts/page.scss": ".page {\n  color: #bbb;\n  background: #fff;\n}\n",
    "pages/index.md": "---\ntitle: Home\n---\n\nPale text on white.\n",
  });
  const build = buildStaticSite(config, root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test", browser: true, loadPlaywright });
  const message = await build.then(() => "built", (e: Error) => e.message);
  expect(message).toContain("pd build: the storefront has accessibility problems in a browser, so nothing was written:");
  expect(message).toMatch(/ {2}- \/: color-contrast \(serious\): Elements must meet minimum color contrast ratio thresholds, on .*\(at 1000×720 and 390×844\)/);
  expect(existsSync(join(root, ".out"))).toBe(false);
});

test("an image whose slot says it is narrower than it is shown is a warning, and the site builds", async () => {
  const root = await project("sizes", {
    "src/styles/layouts/page.scss": ".page img {\n  max-inline-size: 100%;\n  block-size: auto;\n}\n",
    "src/patterns/components/pic/pic.hbs": `<figure>{{pd-image image alt=alt}}</figure>\n`,
    "src/patterns/components/pic/pic.schema.json": JSON.stringify({ required: ["image", "alt"], properties: {
      image: { type: "string", "x-pd-image": { widths: [200, 400, 800, 1200], sizes: "100px" } }, alt: { type: "string" } } }),
    "src/patterns/components/pic/pic.json": JSON.stringify({ image: "/assets/images/flat.png", alt: "A field" }),
    "assets/images/flat.png": flatPng(1200, 600, [30, 80, 140]),
    "pages/index.md": `---\ntitle: Home\n---\n\n<pd-components-pic image="/assets/images/flat.png" alt="A blue field"></pd-components-pic>\n`,
  });
  const report = await buildStaticSite(config, root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test", browser: true, loadPlaywright });
  expect(report.images?.warnings).toEqual([
    expect.stringMatching(/^\/: the image images\/flat is laid out \d+ px wide \(\d+ px at 1x\) but takes the 200w variant, which is too small: its sizes, "100px", says it is narrower than it is \(at 1000×720 and 390×844\)$/),
  ]);
  expect(report.accessibility?.browser).toBe(true);
});

test("the bench passes in a browser: no accessibility finding, every variant fits its box", async () => {
  const cfg = validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, outDir: join(tmp, "bench-site") } }, "storefront-bench");
  const report = await buildStaticSite(cfg, bench, { outDir: join(tmp, "bench-wb"), pdVersion: "0.0.0-test", browser: true, loadPlaywright });
  expect(report.accessibility).toMatchObject({ browser: true, warnings: [] });
  expect(report.images).toEqual({ warnings: [] });
});
